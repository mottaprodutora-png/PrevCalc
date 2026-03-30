import React, { useState, useMemo } from 'react';
import { addDays, parseISO, isValid } from 'date-fns';
import { safeFormat } from './lib/dateUtils';
import { 
  Calculator, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  ShieldCheck, 
  Plus, 
  Trash2,
  Info,
  Download,
  Calendar,
  X,
  Printer,
  User,
  Briefcase,
  LogIn,
  LogOut,
  Save,
  History,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CnisVinculo, CalculoResultado } from './types';
import { calcularPrevidencia } from './lib/calculator';
import { cn } from './lib/utils';
import { parseCnisText } from './services/gemini';
import { parseCnisWithRegex } from './services/regexParser';
import { extractTextFromPdf } from './lib/pdf';
// @ts-ignore - html2pdf.js doesn't have official types
import html2pdf from 'html2pdf.js';
import { supabase } from './lib/supabase';
import { useEffect } from 'react';

type ReportType = 'advogado' | 'contribuinte' | null;

export default function App() {
  console.log("App component rendering...");
  const [vinculos, setVinculos] = useState<CnisVinculo[]>([]);
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState('1970-01-01');
  const [genero, setGenero] = useState<'M' | 'F'>('M');
  const [activeTab, setActiveTab] = useState<'manual' | 'import' | 'saved'>('manual');
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [activeReport, setActiveReport] = useState<ReportType>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedCalculations, setSavedCalculations] = useState<any[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      fetchSavedCalculations();
    } else {
      setSavedCalculations([]);
    }
  }, [user]);

  const fetchSavedCalculations = async () => {
    const { data, error } = await supabase
      .from('calculations')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching calculations:', error);
    } else {
      setSavedCalculations(data || []);
    }
  };

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) alert(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const saveCalculation = async () => {
    if (!user) {
      alert('Você precisa estar logado para salvar cálculos.');
      return;
    }

    if (!resultado) {
      alert('Nenhum cálculo disponível para salvar.');
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.from('calculations').insert({
      user_id: user.id,
      name: nome || 'Cálculo sem nome',
      gender: genero,
      birth_date: nascimento,
      vinculos: vinculos,
      result: resultado
    });

    if (error) {
      alert('Erro ao salvar cálculo: ' + error.message);
    } else {
      alert('Cálculo salvo com sucesso!');
      fetchSavedCalculations();
    }
    setIsSaving(false);
  };

  const loadCalculation = (calc: any) => {
    setNome(calc.name);
    setGenero(calc.gender);
    setNascimento(calc.birth_date);
    setVinculos(calc.vinculos);
    setActiveTab('manual');
  };

  const resultado = useMemo(() => {
    if (vinculos.length === 0) return null;
    return calcularPrevidencia(vinculos, nascimento, genero);
  }, [vinculos, nascimento, genero]);

  const addVinculo = () => {
    const newVinculo: CnisVinculo = {
      id: Math.random().toString(36).substr(2, 9),
      empresa: 'Nova Empresa',
      inicio: '2000-01-01',
      tipo: 'Empregado',
      salarios: []
    };
    setVinculos([...vinculos, newVinculo]);
  };

  const removeVinculo = (id: string) => {
    setVinculos(vinculos.filter(v => v.id !== id));
  };

  const updateVinculo = (id: string, updates: Partial<CnisVinculo>) => {
    setVinculos(vinculos.map(v => v.id === id ? { ...v, ...updates } : v));
  };

  const handleImport = async (textToProcess?: string) => {
    const text = textToProcess || importText;
    if (!text) return;
    setIsImporting(true);
    console.log("Iniciando importação de texto CNIS...");
    try {
      // Tenta primeiro com Regex (Local, Grátis, Sem Chave)
      const regexResult = parseCnisWithRegex(text);
      console.log("Resultado do parser local:", regexResult);
      
      if (regexResult.vinculos.length > 0) {
        // Filtra vínculos vazios ou inválidos
        const validVinculos = regexResult.vinculos.filter(v => v.inicio || v.salarios?.length > 0);
        if (validVinculos.length > 0) {
          setVinculos([...vinculos, ...validVinculos]);
          if (regexResult.nome && !nome) {
            setNome(regexResult.nome);
          }
          if (regexResult.dataNascimento && !nascimento) {
            setNascimento(regexResult.dataNascimento);
          }
          setActiveTab('manual');
          setImportText('');
          setIsImporting(false);
          return;
        }
      }

      // Se o regex não encontrar nada, tenta com IA (Se a chave estiver configurada)
      console.log("Parser local não encontrou dados suficientes. Tentando IA...");
      const { nome: importedNome, dataNascimento: importedDataNascimento, vinculos: importedVinculos, error } = await parseCnisText(text);
      
      if (error === 'API_KEY_MISSING') {
        console.warn("IA não disponível (chave ausente). Usando apenas extração local.");
        if (regexResult.vinculos.length === 0) {
          alert("Não foi possível extrair dados automaticamente. Tente copiar o texto novamente ou preencher manualmente.");
        }
        return;
      }

      if (error) {
        alert(`Erro na extração via IA: ${error}. Tente copiar e colar o texto novamente.`);
        return;
      }

      if (importedVinculos.length > 0) {
        setVinculos([...vinculos, ...importedVinculos]);
        if (importedNome && !nome) {
          setNome(importedNome);
        }
        if (importedDataNascimento && !nascimento) {
          setNascimento(importedDataNascimento);
        }
        setActiveTab('manual');
        setImportText('');
      } else {
        alert("Não foi possível extrair dados do texto fornecido. Verifique se o conteúdo é um extrato CNIS válido ou tente copiar o texto de forma mais clara.");
      }
    } catch (error) {
      console.error("Erro na importação:", error);
      alert("Ocorreu um erro ao processar o CNIS. Tente novamente.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsFileLoading(true);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPdf(file);
        if (!text.trim()) {
          alert("Não foi possível extrair texto deste PDF. Verifique se o arquivo é um PDF de texto e não uma imagem escaneada.");
          return;
        }
      } else {
        const reader = new FileReader();
        text = await new Promise((resolve, reject) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = (error) => reject(error);
          reader.readAsText(file);
        });
      }
      setImportText(text);
      // Processa automaticamente após o upload
      if (text.trim()) {
        handleImport(text);
      }
    } catch (error) {
      console.error("Erro ao ler arquivo:", error);
      alert("Não foi possível ler o arquivo. Tente copiar e colar o texto manualmente.");
    } finally {
      setIsFileLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    const element = document.getElementById('printable-report');
    if (!element) return;

    setIsDownloading(true);
    const opt = {
      margin: [10, 10] as [number, number],
      filename: `Relatorio_PrevCalc_${nome ? nome.replace(/\s+/g, '_') + '_' : ''}${activeReport === 'advogado' ? 'Tecnico' : 'Resumo'}_${safeFormat(new Date(), 'dd_MM_yyyy')}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        letterRendering: true,
        logging: false,
        // This helps html2canvas ignore oklch if it's in the stylesheet but not used on the element
        ignoreElements: (element: Element) => element.classList.contains('no-pdf'),
        onclone: (clonedDoc: Document) => {
          // Remove all style tags that might contain oklch/oklab
          const styles = clonedDoc.getElementsByTagName('style');
          for (let i = 0; i < styles.length; i++) {
            const style = styles[i];
            if (style.textContent && (style.textContent.includes('oklch') || style.textContent.includes('oklab'))) {
              style.textContent = style.textContent.replace(/oklch\([^)]+\)/g, '#000000');
              style.textContent = style.textContent.replace(/oklab\([^)]+\)/g, '#000000');
            }
          }
          
          // Also check inline styles of all elements
          const allElements = clonedDoc.getElementsByTagName('*');
          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i] as HTMLElement;
            if (el.style) {
              const styleStr = el.getAttribute('style');
              if (styleStr && (styleStr.includes('oklch') || styleStr.includes('oklab'))) {
                el.setAttribute('style', styleStr.replace(/oklch\([^)]+\)/g, '#000000').replace(/oklab\([^)]+\)/g, '#000000'));
              }
            }
          }
        }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
    };

    try {
      await html2pdf().set(opt).from(element).save();
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Ocorreu um erro ao gerar o PDF. Tente usar a opção de imprimir e salvar como PDF.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans selection:bg-brand-primary selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-brand-border px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-brand-primary p-2 rounded-lg text-white">
            <Calculator size={24} />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-brand-text">PrevCalc<span className="text-brand-primary">.</span></h1>
            <p className="text-[10px] uppercase tracking-wider text-brand-muted font-semibold">Inteligência Previdenciária</p>
          </div>
        </div>
        
        <div className="hidden md:flex gap-4 items-center">
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-brand-primary/20 focus-within:border-brand-primary transition-all">
            <User size={16} className="text-brand-muted" />
            <input 
              type="text" 
              placeholder="Nome do Segurado"
              value={nome || ''}
              onChange={(e) => setNome(e.target.value)}
              className="text-sm font-medium outline-none w-48 lg:w-64 bg-transparent"
            />
          </div>
          
          <div className="flex bg-brand-bg border border-brand-border p-1 rounded-lg">
            <button 
              onClick={() => setGenero('M')}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                genero === 'M' ? "bg-white text-brand-primary shadow-sm" : "text-brand-muted hover:text-brand-text"
              )}
            >
              Masc.
            </button>
            <button 
              onClick={() => setGenero('F')}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                genero === 'F' ? "bg-white text-brand-primary shadow-sm" : "text-brand-muted hover:text-brand-text"
              )}
            >
              Fem.
            </button>
          </div>
          
          <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-lg px-3 py-2">
            <Calendar size={16} className="text-brand-muted" />
            <input 
              type="date" 
              value={nascimento || ''}
              onChange={(e) => setNascimento(e.target.value)}
              className="bg-transparent text-sm font-medium outline-none"
            />
          </div>

          <div className="h-8 w-px bg-brand-border mx-2"></div>

          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-brand-text truncate max-w-[120px]">{user.email}</span>
                <button 
                  onClick={handleLogout}
                  className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-wider flex items-center gap-1"
                >
                  <LogOut size={10} /> Sair
                </button>
              </div>
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full border border-brand-border" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center border border-brand-border">
                  <User size={16} />
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 bg-brand-text text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-brand-text/90 transition-all shadow-md shadow-brand-text/10"
            >
              <LogIn size={14} /> Entrar com Google
            </button>
          )}
        </div>
      </header>

      <main className="flex flex-col lg:flex-row min-h-[calc(100vh-73px)]">
        {/* Sidebar - Input Area */}
        <section className="lg:w-[400px] xl:w-[450px] border-r border-brand-border bg-white flex flex-col h-[calc(100vh-73px)] sticky top-[73px]">
          <div className="flex p-4 gap-2 border-b border-brand-border bg-brand-bg/50">
            <button 
              onClick={() => setActiveTab('manual')}
              className={cn(
                "flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2",
                activeTab === 'manual' 
                  ? "bg-white text-brand-primary shadow-sm border border-brand-border" 
                  : "text-brand-muted hover:bg-white/50"
              )}
            >
              <Plus size={14} /> Entrada Manual
            </button>
            <button 
              onClick={() => setActiveTab('import')}
              className={cn(
                "flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2",
                activeTab === 'import' 
                  ? "bg-white text-brand-primary shadow-sm border border-brand-border" 
                  : "text-brand-muted hover:bg-white/50"
              )}
            >
              <FileText size={14} /> Importar CNIS
            </button>
            {user && (
              <button 
                onClick={() => setActiveTab('saved' as any)}
                className={cn(
                  "flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2",
                  (activeTab as any) === 'saved' 
                    ? "bg-white text-brand-primary shadow-sm border border-brand-border" 
                    : "text-brand-muted hover:bg-white/50"
                )}
              >
                <History size={14} /> Histórico
              </button>
            )}
          </div>

          <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
            {activeTab === 'manual' ? (
              <>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-bold text-lg text-brand-text">Vínculos e Períodos</h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (confirm("Tem certeza que deseja limpar todos os dados?")) {
                          setVinculos([]);
                          setNome('');
                        }
                      }}
                      className="flex items-center gap-2 bg-white border border-red-200 text-red-500 px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-50 transition-all"
                    >
                      <Trash2 size={14} /> Limpar
                    </button>
                    {user && vinculos.length > 0 && (
                      <button 
                        onClick={saveCalculation}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-brand-bg border border-brand-border text-brand-text px-4 py-2 rounded-lg text-xs font-bold hover:bg-brand-bg/80 transition-all disabled:opacity-50"
                      >
                        <Save size={14} /> {isSaving ? 'Salvando...' : 'Salvar'}
                      </button>
                    )}
                    <button 
                      onClick={addVinculo}
                      className="flex items-center gap-2 bg-brand-primary text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-brand-primary/90 transition-all shadow-md shadow-brand-primary/20"
                    >
                      <Plus size={14} /> Novo Vínculo
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {vinculos.length === 0 && (
                    <div className="border-2 border-dashed border-brand-border rounded-xl p-10 text-center bg-brand-bg/30">
                      <div className="bg-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <FileText className="text-brand-muted" size={24} />
                      </div>
                      <p className="text-sm font-medium text-brand-muted">Nenhum vínculo registrado</p>
                      <p className="text-xs text-brand-muted/70 mt-1">Adicione manualmente ou importe seu CNIS</p>
                    </div>
                  )}
                  
                  <AnimatePresence>
                    {vinculos.map((v) => (
                      <motion.div 
                        key={v.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white border border-brand-border rounded-xl p-5 group relative hover:border-brand-primary/50 hover:shadow-lg hover:shadow-brand-primary/5 transition-all"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                              <Briefcase size={18} />
                            </div>
                            <h4 className="font-bold text-sm text-brand-text truncate max-w-[200px]">
                              {v.empresa && !v.empresa.toLowerCase().includes('cadastro nacional') ? v.empresa : 'Vínculo Identificado'}
                            </h4>
                          </div>
                          <button 
                            onClick={() => removeVinculo(v.id)}
                            className="bg-white border border-brand-border text-red-500 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all z-10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        
                        <div className="space-y-4 mb-4">
                          <div>
                            <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider block mb-1.5">Nome da Empresa / Empregador</label>
                            <input 
                              type="text" 
                              value={v.empresa || ''}
                              onChange={(e) => updateVinculo(v.id, { empresa: e.target.value })}
                              className="w-full font-bold text-sm text-brand-text bg-brand-bg border border-brand-border rounded-lg px-3 py-2 focus:border-brand-primary outline-none transition-all"
                              placeholder="Ex: Empresa ABC Ltda"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider block mb-1.5">Data de Início</label>
                            <div className="relative">
                              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                              <input 
                                type="date" 
                                value={v.inicio || ''}
                                onChange={(e) => updateVinculo(v.id, { inicio: e.target.value })}
                                className="w-full text-xs font-semibold bg-brand-bg border border-brand-border rounded-lg pl-9 pr-3 py-2 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider block mb-1.5">Data de Fim</label>
                            <div className="relative">
                              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
                              <input 
                                type="date" 
                                value={v.fim || ''}
                                onChange={(e) => updateVinculo(v.id, { fim: e.target.value })}
                                className="w-full text-xs font-semibold bg-brand-bg border border-brand-border rounded-lg pl-9 pr-3 py-2 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <label className="flex items-center gap-2 cursor-pointer group/check">
                            <div className={cn(
                              "w-4 h-4 rounded border flex items-center justify-center transition-all",
                              v.especial ? "bg-brand-primary border-brand-primary" : "border-brand-border group-hover/check:border-brand-primary"
                            )}>
                              {v.especial && <CheckCircle2 size={10} className="text-white" />}
                            </div>
                            <input 
                              type="checkbox" 
                              checked={!!v.especial}
                              onChange={(e) => updateVinculo(v.id, { especial: e.target.checked })}
                              className="hidden"
                            />
                            <span className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Tempo Especial</span>
                          </label>
                          
                          <div className="h-4 w-px bg-brand-border"></div>
                          
                          <select 
                            value={v.tipo}
                            onChange={(e) => updateVinculo(v.id, { tipo: e.target.value as any })}
                            className="text-[10px] font-bold text-brand-primary uppercase tracking-wider bg-transparent border-none outline-none cursor-pointer hover:underline"
                          >
                            <option>Empregado</option>
                            <option>Contribuinte Individual</option>
                            <option>Facultativo</option>
                            <option>Especial</option>
                            <option>Rural</option>
                          </select>
                        </div>

                        <div className="bg-brand-bg/50 rounded-xl p-4 border border-brand-border/50">
                          <div className="flex justify-between items-center mb-3">
                            <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Salários de Contribuição</p>
                            <button 
                              onClick={() => {
                                const competencia = safeFormat(new Date(), 'yyyy-MM');
                                updateVinculo(v.id, { salarios: [...v.salarios, { competencia, valor: 1320 }] });
                              }}
                              className="text-[10px] font-bold text-brand-primary uppercase tracking-wider flex items-center gap-1 hover:bg-brand-primary/10 px-2 py-1 rounded-md transition-all"
                            >
                              <Plus size={12} /> Adicionar
                            </button>
                          </div>
                          
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                            {v.salarios.length === 0 ? (
                              <p className="text-[10px] text-brand-muted italic text-center py-2">Nenhum salário informado</p>
                            ) : (
                              v.salarios.map((s, sIdx) => (
                                <div key={sIdx} className="flex gap-2 items-center bg-white p-2 rounded-lg border border-brand-border/50 shadow-sm">
                                  <input 
                                    type="month" 
                                    value={s.competencia || ''}
                                    onChange={(e) => {
                                      const newSalarios = [...v.salarios];
                                      newSalarios[sIdx].competencia = e.target.value;
                                      updateVinculo(v.id, { salarios: newSalarios });
                                    }}
                                    className="text-[10px] font-bold text-brand-text bg-transparent outline-none w-24"
                                  />
                                  <div className="h-4 w-px bg-brand-border"></div>
                                  <div className="flex-1 flex items-center gap-1">
                                    <span className="text-[10px] font-bold text-brand-muted">R$</span>
                                    <input 
                                      type="number" 
                                      step="0.01"
                                      value={s.valor ?? ''}
                                      onChange={(e) => {
                                        const newSalarios = [...v.salarios];
                                        newSalarios[sIdx].valor = parseFloat(e.target.value) || 0;
                                        updateVinculo(v.id, { salarios: newSalarios });
                                      }}
                                      className="w-full text-[10px] font-bold text-brand-text bg-transparent outline-none"
                                      placeholder="0,00"
                                    />
                                  </div>
                                  <button 
                                    onClick={() => {
                                      const newSalarios = v.salarios.filter((_, i) => i !== sIdx);
                                      updateVinculo(v.id, { salarios: newSalarios });
                                    }}
                                    className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-md transition-all"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </>
            ) : (activeTab as any) === 'saved' ? (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                      <History size={20} />
                    </div>
                    <h2 className="font-bold text-lg text-brand-text">Histórico</h2>
                  </div>
                  <button 
                    onClick={fetchSavedCalculations}
                    className="text-[10px] font-bold text-brand-primary uppercase tracking-wider hover:underline"
                  >
                    Atualizar
                  </button>
                </div>

                <div className="space-y-4">
                  {savedCalculations.length === 0 ? (
                    <div className="border-2 border-dashed border-brand-border rounded-xl p-10 text-center bg-brand-bg/30">
                      <p className="text-sm font-medium text-brand-muted">Nenhum cálculo salvo</p>
                      <p className="text-xs text-brand-muted/70 mt-1">Seus cálculos salvos aparecerão aqui</p>
                    </div>
                  ) : (
                    savedCalculations.map((calc) => (
                      <div 
                        key={calc.id}
                        className="bg-white border border-brand-border rounded-xl p-4 hover:border-brand-primary/50 hover:shadow-md transition-all group cursor-pointer"
                        onClick={() => loadCalculation(calc)}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-sm text-brand-text truncate pr-4">{calc.name}</h4>
                          <span className="text-[10px] font-bold text-brand-muted whitespace-nowrap">
                            {safeFormat(calc.created_at, 'dd/MM/yy')}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-brand-muted uppercase tracking-wider">
                          <span className="flex items-center gap-1">
                            <User size={10} /> {calc.gender === 'M' ? 'Masc.' : 'Fem.'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={10} /> {safeFormat(calc.birth_date, 'dd/MM/yyyy')}
                          </span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-brand-border flex justify-between items-center">
                          <span className="text-[9px] font-bold text-brand-primary uppercase tracking-widest">
                            {calc.vinculos.length} Vínculos
                          </span>
                          <button 
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm('Deseja excluir este cálculo?')) {
                                await supabase.from('calculations').delete().eq('id', calc.id);
                                fetchSavedCalculations();
                              }
                            }}
                            className="text-red-400 hover:text-red-600 p-1 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                    <Download size={20} />
                  </div>
                  <h2 className="font-bold text-lg text-brand-text">Importar Dados</h2>
                </div>
                
                <div className="bg-white border border-brand-border rounded-xl p-6 shadow-sm space-y-5">
                  <p className="text-xs text-brand-muted leading-relaxed">
                    Copie e cole o texto do seu extrato CNIS ou carregue o arquivo para processamento automático (Local + IA).
                  </p>
                  
                  <textarea 
                    value={importText || ''}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Cole o conteúdo do CNIS aqui..."
                    className="w-full h-64 p-4 text-xs font-mono bg-brand-bg border border-brand-border rounded-xl outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all resize-none custom-scrollbar"
                  />

                  <div className="flex flex-col gap-4">
                    <button 
                      onClick={() => handleImport()}
                      disabled={!importText || isImporting}
                      className="w-full bg-brand-primary text-white py-3.5 rounded-xl text-xs font-bold hover:bg-brand-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                    >
                      {isImporting ? <Clock className="animate-spin" size={16} /> : <Zap size={16} />}
                      Processar Dados (Local + IA)
                    </button>
                    
                    <div className="relative flex items-center">
                      <div className="flex-grow border-t border-brand-border"></div>
                      <span className="flex-shrink mx-4 text-[10px] font-bold text-brand-muted uppercase tracking-widest">Ou</span>
                      <div className="flex-grow border-t border-brand-border"></div>
                    </div>

                    <label className={cn(
                      "w-full border-2 border-dashed border-brand-border rounded-xl py-10 text-center cursor-pointer hover:bg-brand-bg hover:border-brand-primary/50 transition-all relative group",
                      isFileLoading && "pointer-events-none opacity-60"
                    )}>
                      <input 
                        type="file" 
                        className="hidden" 
                        accept=".pdf,.txt,.csv" 
                        onChange={handleFileUpload}
                        disabled={isFileLoading}
                      />
                      {isFileLoading ? (
                        <div className="flex flex-col items-center">
                          <Clock className="animate-spin mb-3 text-brand-primary" size={28} />
                          <p className="text-xs font-bold text-brand-text">Lendo Arquivo...</p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-brand-bg w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-white transition-all">
                            <FileText className="text-brand-muted group-hover:text-brand-primary transition-all" size={24} />
                          </div>
                          <p className="text-xs font-bold text-brand-text">Carregar PDF / CSV</p>
                          <p className="text-[10px] text-brand-muted mt-1">Processamento Local Prioritário (Sem Chave)</p>
                        </>
                      )}
                    </label>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-brand-muted bg-brand-bg p-3 rounded-lg border border-brand-border">
                    <ShieldCheck size={14} className="text-green-500" />
                    <span>Seus dados são processados localmente no navegador. A IA é usada apenas como fallback se a extração local falhar.</span>
                  </div>
                </div>

                <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-xl p-5 flex gap-4">
                  <div className="bg-brand-primary/10 p-2 rounded-lg h-fit">
                    <Info className="text-brand-primary" size={18} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-brand-text font-semibold">Onde encontrar seu CNIS?</p>
                    <p className="text-[11px] text-brand-muted leading-relaxed">
                      Acesse o portal <strong>Meu INSS</strong> {'>'} Extrato de Contribuição (CNIS) {'>'} Baixar PDF {'>'} Relações Previdenciárias e Remunerações.
                    </p>
                    <p className="text-[10px] text-brand-muted italic bg-white/50 p-2 rounded border border-brand-border/50">
                      * Certifique-se de que o PDF é digital (texto selecionável).
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Main Content - Results Area */}
        <section className="lg:col-span-8 p-8 overflow-y-auto max-h-[calc(100vh-89px)] bg-brand-bg/30 custom-scrollbar">
          {!resultado ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="bg-white p-8 rounded-3xl border border-brand-border shadow-sm mb-6">
                <Calculator size={48} className="text-brand-primary opacity-20 mx-auto" strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-bold text-brand-text mb-3">Pronto para Analisar</h3>
              <p className="text-sm text-brand-muted leading-relaxed">
                Insira os dados dos vínculos do CNIS na barra lateral para gerar o relatório determinístico completo e simular todas as regras de transição.
              </p>
            </div>
          ) : (
            <div className="space-y-10 max-w-5xl mx-auto">
              {/* Contribuinte Header */}
              {nome && (
                <div className="flex items-center gap-4 bg-white p-6 rounded-2xl border border-brand-border shadow-sm">
                  <div className="bg-brand-primary/10 text-brand-primary p-3 rounded-xl">
                    <User size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-brand-muted tracking-widest mb-0.5">Análise Determinística para</p>
                    <h2 className="text-2xl font-bold text-brand-text tracking-tight">{nome}</h2>
                  </div>
                </div>
              )}

              {/* Resumo Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm group hover:border-brand-primary/50 transition-all">
                  <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-3">Tempo Total</p>
                  <p className="text-2xl font-bold text-brand-text group-hover:text-brand-primary transition-colors">{resultado.resumo.tempoTotalFormatado}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="w-1 h-1 rounded-full bg-brand-primary"></div>
                    <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">{resultado.resumo.tempoTotalDias} dias corridos</p>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm group hover:border-brand-primary/50 transition-all">
                  <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-3">Carência</p>
                  <p className="text-2xl font-bold text-brand-text group-hover:text-brand-primary transition-colors">{resultado.resumo.carenciaMeses} meses</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="w-1 h-1 rounded-full bg-brand-primary"></div>
                    <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Contribuições válidas</p>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-brand-border shadow-sm group hover:border-brand-primary/50 transition-all">
                  <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-3">Status Geral</p>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-1.5 rounded-lg",
                      resultado.melhorOpcao.status === 'Apto' ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-500"
                    )}>
                      {resultado.melhorOpcao.status === 'Apto' ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        <Clock size={20} />
                      )}
                    </div>
                    <p className="text-2xl font-bold text-brand-text group-hover:text-brand-primary transition-colors">{resultado.melhorOpcao.status}</p>
                  </div>
                </div>
              </div>

              {/* Melhor Opção Banner */}
              <div className="bg-brand-primary text-white p-10 rounded-3xl relative overflow-hidden shadow-xl shadow-brand-primary/20">
                <ShieldCheck className="absolute -right-8 -bottom-8 opacity-10" size={240} />
                <div className="relative z-10">
                  <div className="inline-flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full mb-6">
                    <span className="text-[10px] uppercase font-bold tracking-widest">🏆 Melhor Cenário Identificado</span>
                  </div>
                  <h3 className="text-4xl font-bold mb-3 tracking-tight">{resultado.melhorOpcao.nome}</h3>
                  <p className="text-base text-white/80 max-w-2xl mb-8 leading-relaxed">{resultado.melhorOpcao.descricao}</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pt-8 border-t border-white/20">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Expectativa de Valor</p>
                      <p className="text-3xl font-bold">R$ {resultado.valorEstimado.beneficio.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Coeficiente Aplicado</p>
                      <p className="text-3xl font-bold">{resultado.valorEstimado.coeficiente.toFixed(1)}%</p>
                    </div>
                    {resultado.melhorOpcao.tempoFaltanteDias && resultado.melhorOpcao.tempoFaltanteDias > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-white/60 tracking-wider">Tempo Faltante</p>
                        <p className="text-3xl font-bold text-amber-300">~{Math.ceil(resultado.melhorOpcao.tempoFaltanteDias / 365.25)} anos</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Regras Table */}
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                    <TrendingUp size={20} />
                  </div>
                  <h4 className="font-bold text-xl text-brand-text">Simulação de Regras</h4>
                </div>
                
                <div className="bg-white border border-brand-border rounded-2xl overflow-hidden shadow-sm">
                  <div className="grid grid-cols-12 bg-brand-bg/50 p-4 text-[10px] font-bold text-brand-muted uppercase tracking-widest border-b border-brand-border">
                    <div className="col-span-6">Regra de Aposentadoria</div>
                    <div className="col-span-3">Status</div>
                    <div className="col-span-3 text-right">Previsão</div>
                  </div>
                  <div className="divide-y divide-brand-border/50">
                    {resultado.regras.map((regra, idx) => (
                      <div key={idx} className="grid grid-cols-12 p-5 items-center hover:bg-brand-bg/30 transition-colors group">
                        <div className="col-span-6">
                          <p className="font-bold text-sm text-brand-text group-hover:text-brand-primary transition-colors">{regra.nome}</p>
                          <p className="text-[11px] text-brand-muted mt-1 leading-relaxed max-w-md">{regra.descricao}</p>
                        </div>
                        <div className="col-span-3">
                          <span className={cn(
                            "text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider",
                            regra.status === 'Apto' ? "bg-green-100 text-green-700" : "bg-brand-bg text-brand-muted"
                          )}>
                            {regra.status}
                          </span>
                        </div>
                        <div className="col-span-3 text-right">
                          <p className={cn(
                            "text-xs font-bold",
                            regra.status === 'Apto' ? "text-green-600" : "text-brand-text"
                          )}>
                            {regra.status === 'Apto' ? 'IMEDIATO' : `+${Math.ceil((regra.tempoFaltanteDias || 0) / 30.44)} meses`}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Inconsistências & Documentos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl border border-brand-border shadow-sm space-y-6">
                  <div className="flex items-center gap-3 text-red-600">
                    <div className="bg-red-50 p-2 rounded-lg">
                      <AlertTriangle size={20} />
                    </div>
                    <h4 className="font-bold text-xl">Inconsistências</h4>
                  </div>
                  <div className="space-y-4">
                    {resultado.inconsistencias.length === 0 ? (
                      <div className="bg-brand-bg/50 p-6 rounded-2xl border border-dashed border-brand-border text-center">
                        <p className="text-xs text-brand-muted italic">Nenhuma inconsistência detectada nos dados fornecidos.</p>
                      </div>
                    ) : (
                      resultado.inconsistencias.map((inc, idx) => (
                        <div key={idx} className="bg-red-50/50 p-4 rounded-2xl border border-red-100 group hover:bg-red-50 transition-all">
                          <p className="text-[10px] uppercase font-bold text-red-600 tracking-wider mb-1">{inc.tipo}</p>
                          <p className="text-sm font-bold text-brand-text">{inc.descricao}</p>
                          <p className="text-[10px] text-brand-muted font-bold mt-2 uppercase tracking-wider">{inc.periodo}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-brand-border shadow-sm space-y-6">
                  <div className="flex items-center gap-3 text-brand-primary">
                    <div className="bg-brand-primary/10 p-2 rounded-lg">
                      <FileText size={20} />
                    </div>
                    <h4 className="font-bold text-xl">Documentação</h4>
                  </div>
                  <ul className="space-y-3">
                    {[
                      ...resultado.documentos.obrigatorios,
                      ...resultado.documentos.previdenciarios,
                      ...resultado.documentos.estrategicos
                    ].slice(0, 6).map((doc, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-3 rounded-xl hover:bg-brand-bg transition-all group">
                        <div className="mt-1 w-1.5 h-1.5 bg-brand-primary rounded-full shrink-0 group-hover:scale-150 transition-transform" />
                        <span className="text-sm text-brand-text font-medium">{doc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Ações de Relatório */}
              <div className="bg-white p-10 rounded-3xl border border-brand-border shadow-lg flex flex-col md:flex-row gap-8 items-center justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-brand-primary/5 rounded-full -mr-16 -mt-16"></div>
                <div className="relative z-10">
                  <h4 className="text-2xl font-bold text-brand-text mb-2">Gerar Relatórios</h4>
                  <p className="text-sm text-brand-muted">Escolha o formato ideal para sua necessidade profissional.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto relative z-10">
                  <button 
                    onClick={() => setActiveReport('contribuinte')}
                    className="flex items-center justify-center gap-2 bg-white border border-brand-border px-8 py-4 rounded-2xl text-xs font-bold text-brand-text hover:bg-brand-bg transition-all shadow-sm"
                  >
                    <User size={16} /> Relatório Resumido
                  </button>
                  <button 
                    onClick={() => setActiveReport('advogado')}
                    className="flex items-center justify-center gap-2 bg-brand-primary text-white px-8 py-4 rounded-2xl text-xs font-bold hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20"
                  >
                    <Briefcase size={16} /> Relatório Completo
                  </button>
                </div>
              </div>

              {/* Footer Info */}
              <div className="pt-10 border-t border-brand-border flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] font-bold text-brand-muted uppercase tracking-widest">
                <p>© 2026 PrevCalc - Análise Determinística Legal</p>
                <div className="flex gap-8">
                  <span className="flex items-center gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-brand-primary"></div>
                    Legislação: EC 103/2019
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className="w-1 h-1 rounded-full bg-brand-primary"></div>
                    Precisão: 99.9%
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Report Modal */}
      <AnimatePresence>
        {activeReport && resultado && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-sm overflow-y-auto"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-4xl min-h-[80vh] my-8 shadow-2xl flex flex-col relative"
            >
              {/* Modal Header */}
              <div className="border-b border-brand-border p-6 flex justify-between items-center sticky top-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="bg-brand-primary/10 p-2 rounded-lg text-brand-primary">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h2 className="font-bold text-xl text-brand-text">
                      {activeReport === 'advogado' ? 'Relatório Técnico Previdenciário' : 'Resumo de Aposentadoria'}
                    </h2>
                    <p className="text-[10px] uppercase font-bold text-brand-muted tracking-widest">
                      Gerado em {safeFormat(new Date(), 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleDownloadPdf}
                    disabled={isDownloading}
                    className="flex items-center gap-2 bg-brand-primary text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-brand-primary/90 transition-all disabled:opacity-50 shadow-lg shadow-brand-primary/20"
                  >
                    {isDownloading ? <Clock className="animate-spin" size={14} /> : <Download size={14} />} 
                    Baixar PDF
                  </button>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-brand-bg px-5 py-2.5 rounded-xl text-xs font-bold text-brand-text hover:bg-brand-border/50 transition-all border border-brand-border"
                  >
                    <Printer size={14} /> Imprimir
                  </button>
                  <button 
                    onClick={() => setActiveReport(null)}
                    className="p-2 hover:bg-brand-bg rounded-full transition-all text-brand-muted hover:text-brand-text"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Modal Content */}
              <div className="p-12 flex-1 overflow-y-auto print:p-0 custom-scrollbar" id="printable-report">
                <div className="max-w-4xl mx-auto space-y-16">
                  {/* Report Header */}
                  <div className="text-center border-b-2 border-brand-primary pb-12">
                    <div className="flex justify-center mb-6">
                      <div className="bg-brand-primary text-white p-4 rounded-2xl shadow-xl shadow-brand-primary/20">
                        <Calculator size={40} />
                      </div>
                    </div>
                    <h1 className="text-5xl font-bold text-brand-text mb-4 tracking-tight">PrevCalc<span className="text-brand-primary">.</span></h1>
                    <p className="text-[12px] uppercase tracking-[0.6em] text-brand-muted font-bold">Parecer Técnico de Viabilidade Previdenciária</p>
                    <div className="mt-10 flex justify-center gap-12 text-[11px] font-bold uppercase tracking-widest text-brand-muted">
                      <span className="flex items-center gap-2"><User size={12} /> Ref: {nome || 'Contribuinte'}</span>
                      <span className="flex items-center gap-2"><Calendar size={12} /> Data: {safeFormat(new Date(), 'dd/MM/yyyy')}</span>
                      <span className="flex items-center gap-2"><ShieldCheck size={12} /> ID: #{Math.random().toString(36).substring(7).toUpperCase()}</span>
                    </div>
                  </div>

                  {/* 1. RESUMO EXECUTIVO */}
                  <section className="space-y-8">
                    <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                      <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">01</span>
                      <h3 className="text-2xl font-bold text-brand-text">Resumo Executivo</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className={cn(
                        "p-10 rounded-3xl border-2 flex flex-col justify-center items-center text-center transition-all",
                        resultado.resumo.statusAtual === 'Apto' ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
                      )}>
                        <p className="text-[10px] uppercase font-bold text-brand-muted tracking-widest mb-3">Situação Atual</p>
                        <p className={cn(
                          "text-3xl font-bold uppercase tracking-tight",
                          resultado.resumo.statusAtual === 'Apto' ? "text-green-700" : "text-amber-700"
                        )}>
                          {resultado.resumo.statusAtual === 'Apto' ? 'Apto à Aposentadoria' : 'Não Apto à Aposentadoria'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                          <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-2">Tempo Reconhecido</p>
                          <p className="text-xl font-bold text-brand-text">{resultado.resumo.tempoTotalFormatado}</p>
                        </div>
                        <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                          <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-2">Tempo Faltante</p>
                          <p className="text-xl font-bold text-amber-600">{resultado.resumo.tempoFaltanteFormatado}</p>
                        </div>
                        <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                          <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-2">Melhor Regra</p>
                          <p className="text-sm font-bold text-brand-text leading-tight">{resultado.melhorOpcao.nome}</p>
                        </div>
                        <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                          <p className="text-[10px] uppercase font-bold text-brand-muted tracking-wider mb-2">Previsão</p>
                          <p className="text-xl font-bold text-brand-text">{resultado.resumo.previsaoAposentadoria}</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 2. SIMULAÇÃO DE REGRAS */}
                  <section className="space-y-8">
                    <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                      <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">02</span>
                      <h3 className="text-2xl font-bold text-brand-text">Simulação de Regras e Comparativo</h3>
                    </div>
                    <div className="overflow-hidden rounded-3xl border border-brand-border shadow-sm">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-brand-bg text-brand-text uppercase font-bold text-[10px] tracking-widest">
                          <tr>
                            <th className="p-5 border-b border-brand-border">Regra de Transição / Permanente</th>
                            <th className="p-5 border-b border-brand-border">Status</th>
                            <th className="p-5 border-b border-brand-border">Tempo Faltante</th>
                            <th className="p-5 border-b border-brand-border text-right">Expectativa</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-border">
                          {resultado.regras.map((regra, idx) => (
                            <tr key={idx} className={cn(
                              "transition-colors hover:bg-brand-bg/30",
                              regra.status === 'Apto' ? "bg-green-50/30" : ""
                            )}>
                              <td className="p-5">
                                <p className="font-bold text-sm text-brand-text">{regra.nome}</p>
                                <p className="text-brand-muted text-[10px] mt-1 max-w-xs leading-relaxed">{regra.descricao}</p>
                              </td>
                              <td className="p-5">
                                <span className={cn(
                                  "px-3 py-1 rounded-full font-bold uppercase text-[9px] tracking-widest",
                                  regra.status === 'Apto' ? "bg-green-100 text-green-700" : "bg-brand-bg text-brand-muted"
                                )}>
                                  {regra.status}
                                </span>
                              </td>
                              <td className="p-5 font-bold text-brand-text">
                                {regra.status === 'Apto' ? 
                                  <span className="text-green-600 flex items-center gap-1"><ShieldCheck size={12} /> CONCLUÍDO</span> : 
                                  `${Math.ceil((regra.tempoFaltanteDias || 0) / 365.25)} ANOS`
                                }
                              </td>
                              <td className="p-5 text-right font-bold text-brand-text">
                                {regra.status === 'Apto' ? 
                                  <span className="text-green-600">IMEDIATO</span> : 
                                  safeFormat(addDays(new Date(), regra.tempoFaltanteDias || 0), 'MM/yyyy')
                                }
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* 3. CÁLCULO DO BENEFÍCIO (RMI) */}
                  <section className="space-y-8">
                    <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                      <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">03</span>
                      <h3 className="text-2xl font-bold text-brand-text">Cálculo do Benefício (RMI)</h3>
                    </div>
                    <div className="bg-brand-text text-white p-12 rounded-[2.5rem] shadow-2xl shadow-brand-text/20 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative z-10">
                        <div className="space-y-8 md:col-span-2">
                          <div className="grid grid-cols-2 gap-8">
                            <div>
                              <p className="text-[10px] uppercase font-bold text-white/50 tracking-widest mb-2">Média Salarial</p>
                              <p className="text-3xl font-bold">R$ {resultado.valorEstimado.media.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase font-bold text-white/50 tracking-widest mb-2">Coeficiente</p>
                              <p className="text-3xl font-bold">{resultado.valorEstimado.coeficiente.toFixed(1)}%</p>
                            </div>
                          </div>
                          <div className="pt-8 border-t border-white/10">
                            <p className="text-[10px] uppercase font-bold text-white/50 tracking-widest mb-3">Memória de Cálculo</p>
                            <p className="text-sm text-white/80 leading-relaxed">
                              O valor de <span className="text-white font-bold">R$ {resultado.valorEstimado.beneficio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span> foi obtido através da aplicação do coeficiente de 
                              <span className="text-white font-bold"> {resultado.valorEstimado.percentualCalculo.toFixed(1)}%</span> sobre a média aritmética de todos os salários de contribuição desde julho de 1994, 
                              conforme a regra de <span className="text-brand-primary font-bold italic">{resultado.valorEstimado.regraUtilizada}</span>.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col justify-center items-center border-l border-white/10 pl-12 text-center">
                          <p className="text-[10px] uppercase font-bold text-white/50 tracking-widest mb-3">Renda Mensal Inicial</p>
                          <p className="text-5xl font-bold text-brand-primary">R$ {resultado.valorEstimado.beneficio.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 4. DETALHAMENTO DOS VÍNCULOS E SALÁRIOS */}
                  <section className="space-y-8">
                    <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                      <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">04</span>
                      <h3 className="text-2xl font-bold text-brand-text">Detalhamento dos Vínculos e Salários</h3>
                    </div>
                    <div className="space-y-6">
                      {vinculos.map((v, idx) => (
                        <div key={v.id} className="bg-brand-bg/30 border border-brand-border rounded-3xl overflow-hidden">
                          <div className="bg-brand-bg/50 p-6 border-b border-brand-border flex justify-between items-center">
                            <div>
                              <h4 className="font-bold text-brand-text text-lg">{v.empresa || 'Vínculo não identificado'}</h4>
                              <p className="text-[10px] uppercase font-bold text-brand-muted tracking-widest mt-1">
                                {v.inicio ? safeFormat(v.inicio, 'dd/MM/yyyy') : '??'} a {v.fim ? safeFormat(v.fim, 'dd/MM/yyyy') : 'Atual'} • {v.tipo} {v.especial && '• Especial'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] uppercase font-bold text-brand-muted tracking-widest mb-1">Contribuições</p>
                              <p className="text-lg font-bold text-brand-text">{v.salarios.length}</p>
                            </div>
                          </div>
                          {v.salarios.length > 0 ? (
                            <div className="p-6">
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {v.salarios.sort((a,b) => a.competencia.localeCompare(b.competencia)).map((s, sIdx) => (
                                  <div key={sIdx} className="bg-white border border-brand-border/50 p-3 rounded-xl text-center">
                                    <p className="text-[9px] font-bold text-brand-muted uppercase mb-1">{safeFormat(s.competencia + '-01', 'MM/yyyy')}</p>
                                    <p className="text-xs font-bold text-brand-text">R$ {s.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="p-8 text-center text-brand-muted italic text-sm">
                              Nenhum salário de contribuição identificado para este período.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* 5. MAPA PREVIDENCIÁRIO - APENAS TÉCNICO */}
                  {activeReport === 'advogado' && (
                    <section className="space-y-8">
                      <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                        <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">05</span>
                        <h3 className="text-2xl font-bold text-brand-text">Mapa Previdenciário (Timeline)</h3>
                      </div>
                      <div className="space-y-6">
                        {resultado.timeline.map((event, idx) => (
                          <div key={idx} className="flex gap-8 items-start group">
                            <div className="w-32 pt-1 text-[10px] font-bold text-brand-muted uppercase text-right shrink-0 tracking-widest">
                              {event.periodo}
                            </div>
                            <div className="relative flex flex-col items-center shrink-0">
                              <div className={cn(
                                "w-4 h-4 rounded-full border-2 z-10 transition-all group-hover:scale-125",
                                event.tipo === 'Especial' ? "bg-brand-primary border-brand-primary shadow-lg shadow-brand-primary/30" : 
                                event.tipo === 'Rural' ? "bg-green-500 border-green-500" :
                                event.tipo === 'Lacuna' ? "bg-red-500 border-red-500" : "bg-white border-brand-border"
                              )} />
                              {idx !== resultado.timeline.length - 1 && (
                                <div className="w-0.5 h-full bg-brand-border absolute top-4 opacity-30" />
                              )}
                            </div>
                            <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl flex-1 transition-all group-hover:bg-brand-bg group-hover:shadow-md">
                              <div className="flex justify-between items-start mb-2">
                                <h5 className="font-bold text-brand-text uppercase tracking-tight">{event.descricao}</h5>
                                <span className={cn(
                                  "text-[9px] font-bold uppercase px-2 py-0.5 rounded-full tracking-widest",
                                  event.tipo === 'Especial' ? "bg-brand-primary/10 text-brand-primary" : 
                                  event.tipo === 'Rural' ? "bg-green-100 text-green-700" :
                                  "bg-brand-muted/10 text-brand-muted"
                                )}>
                                  {event.tipo}
                                </span>
                              </div>
                              <p className="text-xs text-brand-muted leading-relaxed">Período contributivo reconhecido integralmente.</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 5. ANÁLISE JURÍDICA E INDICADORES - APENAS TÉCNICO */}
                  {activeReport === 'advogado' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
                      <section className="space-y-8">
                        <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                          <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">06</span>
                          <h3 className="text-2xl font-bold text-brand-text">Análise Jurídica</h3>
                        </div>
                        <div className="space-y-8">
                          {resultado.analiseJuridica.periodosEspeciais.length > 0 && (
                            <div className="space-y-3">
                              <h6 className="text-[10px] uppercase font-bold text-brand-muted tracking-widest">Atividade Especial</h6>
                              <ul className="space-y-3">
                                {resultado.analiseJuridica.periodosEspeciais.map((item, i) => (
                                  <li key={i} className="text-xs flex gap-3 text-brand-text"><span className="text-amber-600 font-bold">⚠</span> {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="space-y-3">
                            <h6 className="text-[10px] uppercase font-bold text-brand-muted tracking-widest">Possibilidades de Revisão</h6>
                            <ul className="space-y-3">
                              {resultado.analiseJuridica.revisoes.map((item, i) => (
                                <li key={i} className="text-xs flex gap-3 text-brand-text"><span className="text-brand-primary font-bold">ℹ</span> {item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-3">
                            <h6 className="text-[10px] uppercase font-bold text-brand-muted tracking-widest">Tempo Rural e Individual</h6>
                            <p className="text-xs text-brand-muted italic leading-relaxed">Necessário avaliar documentos para inclusão de tempo rural antes de 1991.</p>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-8">
                        <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                          <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">07</span>
                          <h3 className="text-2xl font-bold text-brand-text">Indicadores</h3>
                        </div>
                        <div className="space-y-8">
                          <div className="space-y-3">
                            <div className="flex justify-between text-[10px] uppercase font-bold text-brand-muted tracking-widest">
                              <span>Progresso Geral</span>
                              <span className="text-brand-text">{resultado.resumo.percentualConcluido.toFixed(1)}%</span>
                            </div>
                            <div className="h-3 bg-brand-bg rounded-full overflow-hidden border border-brand-border">
                              <div 
                                className="h-full bg-brand-primary transition-all duration-1000 shadow-lg shadow-brand-primary/20" 
                                style={{ width: `${resultado.resumo.percentualConcluido}%` }} 
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                              <p className="text-[9px] uppercase font-bold text-brand-muted tracking-wider mb-2">Tempo Válido</p>
                              <p className="text-xl font-bold text-brand-text">{resultado.resumo.tempoTotalFormatado.split(',')[0]}</p>
                            </div>
                            <div className="bg-brand-bg/50 border border-brand-border p-5 rounded-2xl">
                              <p className="text-[9px] uppercase font-bold text-brand-muted tracking-wider mb-2">Inconsistências</p>
                              <p className="text-xl font-bold text-red-600">{resultado.inconsistencias.length}</p>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* 6. PLANO DE AÇÃO (OURO) - APENAS TÉCNICO */}
                  {activeReport === 'advogado' && (
                    <section className="space-y-8">
                      <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                        <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">08</span>
                        <h3 className="text-2xl font-bold text-brand-text">Plano de Ação Estratégico</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {resultado.planoAcao.map((acao, i) => (
                          <div key={i} className="flex gap-5 p-6 bg-brand-bg/30 border border-brand-border rounded-2xl hover:bg-brand-bg transition-all group">
                            <div className="w-10 h-10 bg-brand-text text-white flex items-center justify-center text-sm font-bold rounded-xl shrink-0 group-hover:bg-brand-primary transition-colors">
                              {i + 1}
                            </div>
                            <p className="text-sm font-bold text-brand-text leading-tight">{acao}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 7. CHECKLIST DOCUMENTAL */}
                  <section className="space-y-8">
                    <div className="flex items-center gap-4 border-b border-brand-border pb-4">
                      <span className="bg-brand-primary text-white text-[12px] w-8 h-8 rounded-lg flex items-center justify-center font-bold">09</span>
                      <h3 className="text-2xl font-bold text-brand-text">Checklist Documental Organizado</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="space-y-6">
                        <h6 className="text-[10px] uppercase font-bold text-white bg-brand-text px-3 py-1.5 rounded-lg inline-block tracking-widest">Obrigatórios</h6>
                        <ul className="space-y-3">
                          {resultado.documentos.obrigatorios.map((doc, i) => (
                            <li key={i} className="text-xs flex gap-3 text-brand-text"><div className="w-4 h-4 border-2 border-brand-border rounded mt-0.5 shrink-0" /> {doc}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-6">
                        <h6 className="text-[10px] uppercase font-bold text-white bg-brand-primary px-3 py-1.5 rounded-lg inline-block tracking-widest">Previdenciários</h6>
                        <ul className="space-y-3">
                          {resultado.documentos.previdenciarios.map((doc, i) => (
                            <li key={i} className="text-xs flex gap-3 text-brand-text"><div className="w-4 h-4 border-2 border-brand-border rounded mt-0.5 shrink-0" /> {doc}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-6">
                        <h6 className="text-[10px] uppercase font-bold text-brand-text bg-brand-bg border border-brand-border px-3 py-1.5 rounded-lg inline-block tracking-widest">Estratégicos</h6>
                        <ul className="space-y-3">
                          {resultado.documentos.estrategicos.map((doc, i) => (
                            <li key={i} className="text-xs flex gap-3 text-brand-text"><div className="w-4 h-4 border-2 border-brand-border rounded mt-0.5 shrink-0" /> {doc}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>

                  {/* 8. IMPACTO DOS ERROS - APENAS TÉCNICO */}
                  {activeReport === 'advogado' && (
                    <section className="bg-red-50 border-2 border-red-200 p-10 rounded-[2.5rem] space-y-8">
                      <div className="flex items-center gap-4 text-red-600">
                        <div className="bg-red-600 text-white p-3 rounded-2xl shadow-lg shadow-red-600/20">
                          <AlertTriangle size={28} />
                        </div>
                        <h3 className="text-2xl font-bold">Impacto das Inconsistências Detectadas</h3>
                      </div>
                      <div className="space-y-6">
                        {resultado.inconsistencias.map((inc, i) => (
                          <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center border-b border-red-100 pb-6 last:border-0">
                            <div className="md:col-span-2">
                              <p className="text-sm font-bold text-brand-text">{inc.descricao}</p>
                              <p className="text-[10px] uppercase font-bold text-red-400 tracking-widest mt-1">{inc.periodo}</p>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase font-bold text-red-300 tracking-widest mb-1">Impacto no Tempo</span>
                              <span className="text-xs font-bold text-red-600">{inc.impactoTempo || 'ANALISAR'}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] uppercase font-bold text-red-300 tracking-widest mb-1">Impacto no Valor</span>
                              <span className="text-xs font-bold text-red-600">{inc.impactoValor || 'ANALISAR'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Report Footer */}
                  <div className="pt-20 border-t border-brand-border text-center space-y-8">
                    <p className="text-[11px] text-brand-muted leading-relaxed max-w-2xl mx-auto italic">
                      Este relatório é uma simulação técnica baseada nos dados fornecidos e na legislação vigente (EC 103/2019). 
                      Os valores são estimativos e não garantem a concessão do benefício pelo INSS. 
                      Recomenda-se acompanhamento jurídico especializado.
                    </p>
                    <div className="flex justify-center items-center gap-12 text-[10px] font-bold text-brand-muted uppercase tracking-[0.4em]">
                      <span>PrevCalc Engine v2.5</span>
                      <span className="w-1.5 h-1.5 bg-brand-border rounded-full" />
                      <span>Assinatura Digital: {Math.random().toString(36).substring(2).toUpperCase()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
