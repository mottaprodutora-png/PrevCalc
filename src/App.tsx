import React, { useState, useMemo } from 'react';
import { FileText, Calculator, History, Settings, LogOut, Upload, Download, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { parseCnisText } from './services/gemini';
import { calcularPrevidencia } from './lib/calculator';
import { CnisVinculo, ResultadoCalculo } from './types';
import html2pdf from 'html2pdf.js';

function App() {
  const [vinculos, setVinculos] = useState<CnisVinculo[]>([]);
  const [loading, setLoading] = useState(false);
  const [nomeSegurado, setNomeSegurado] = useState('');

  const resultado = useMemo(() => {
    if (vinculos.length === 0) return null;
    return calcularPrevidencia(vinculos);
  }, [vinculos]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = "Texto extraído do PDF via FileReader ou Biblioteca"; 
      const data = await parseCnisText(text);
      setVinculos(data.vinculos);
      setNomeSegurado(data.nome);
    } catch (error) {
      console.error("Erro ao processar:", error);
    } finally {
      setLoading(false);
    }
  };

  const exportToPdf = () => {
    const element = document.getElementById('report-content');
    if (!element) return;

    const opt = {
      margin: [10, 10],
      filename: `Relatorio_PrevCalc_${nomeSegurado.replace(/ /g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Limpeza de estilos problemáticos antes de gerar
    const styles = document.createElement('style');
    styles.innerHTML = `
      #report-content * { color: #000 !important; text-shadow: none !important; }
      .bg-gradient-to-br { background: #f3f4f6 !important; }
      .text-white { color: #000 !important; }
    `;
    document.head.appendChild(styles);

    html2pdf().from(element).set(opt).save().then(() => {
      document.head.removeChild(styles);
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar Simples */}
      <div className="w-64 bg-slate-900 text-white p-6">
        <h1 className="text-2xl font-bold mb-8">PrevCalc</h1>
        <nav className="space-y-4">
          <div className="flex items-center gap-3 text-blue-400"><Calculator size={20}/> Simulador</div>
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 p-8">
        {!resultado ? (
          <div className="max-w-xl mx-auto mt-20 p-12 border-2 border-dashed border-gray-300 rounded-2xl text-center">
            <Upload className="mx-auto mb-4 text-gray-400" size={48} />
            <h2 className="text-xl font-semibold mb-2">Importar CNIS</h2>
            <input type="file" onChange={handleFileUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          </div>
        ) : (
          <div id="report-content" className="max-w-4xl mx-auto bg-white p-8 shadow-lg rounded-lg">
            <div className="flex justify-between items-center mb-8 border-b pb-4">
              <h2 className="text-2xl font-bold">Parecer Técnico: {nomeSegurado}</h2>
              <button onClick={exportToPdf} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded">
                <Download size={18} /> Exportar PDF
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-6 mb-8">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600">Tempo Total</p>
                <p className="text-2xl font-bold">{resultado.tempoTotal.anos} anos</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600">Média Salarial</p>
                <p className="text-2xl font-bold">R$ {resultado.mediaSalarial.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
              </div>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="p-2 border">Empresa/Vínculo</th>
                  <th className="p-2 border">Início</th>
                  <th className="p-2 border">Fim</th>
                </tr>
              </thead>
              <tbody>
                {vinculos.map((v, i) => (
                  <tr key={i}>
                    <td className="p-2 border">{v.empresa}</td>
                    <td className="p-2 border">{v.dataInicio}</td>
                    <td className="p-2 border">{v.dataFim || 'Atual'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
