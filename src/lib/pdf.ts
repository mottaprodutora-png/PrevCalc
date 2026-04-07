import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;

    // Filtra itens vazios
    const validItems = items.filter(item => item.str.trim());

    // Detecta número de colunas analisando distribuição horizontal
    const numColunas = detectarColunas(validItems, pageWidth);

    const pageText = numColunas > 1
      ? extrairTextoMulticolunas(validItems, pageWidth, numColunas)
      : extrairTextoSimples(validItems);

    fullText += pageText + '\n';
  }

  return fullText;
}

// Detecta automaticamente quantas colunas o PDF tem
function detectarColunas(items: any[], pageWidth: number): number {
  if (items.length === 0) return 1;

  // Agrupa itens por linha Y
  const linhas = agruparPorY(items);

  // Conta linhas que têm itens em zonas X muito diferentes
  let linhasMulticolunas = 0;
  const threshold = pageWidth * 0.3; // gap mínimo de 30% da largura para considerar coluna

  for (const linha of linhas) {
    if (linha.items.length < 2) continue;
    linha.items.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
    
    const xMin = linha.items[0].transform[4];
    const xMax = linha.items[linha.items.length - 1].transform[4];
    
    // Verifica se há um gap grande no meio (indica múltiplas colunas)
    let maxGap = 0;
    for (let i = 1; i < linha.items.length; i++) {
      const gap = linha.items[i].transform[4] - linha.items[i-1].transform[4];
      if (gap > maxGap) maxGap = gap;
    }
    
    if (maxGap > threshold) linhasMulticolunas++;
  }

  // Se mais de 20% das linhas têm gap grande, é multicolunas
  const percentual = linhasMulticolunas / linhas.length;
  
  if (percentual > 0.2) {
    // Tenta detectar se são 2 ou 3 colunas
    return detectarNumColunas(items, pageWidth);
  }
  
  return 1;
}

function detectarNumColunas(items: any[], pageWidth: number): number {
  // Analisa concentração de posições X para encontrar colunas
  const xPositions = items.map(item => item.transform[4]);
  
  // Divide a página em zonas e conta itens em cada zona
  const zonas = 3;
  const counts = new Array(zonas).fill(0);
  
  for (const x of xPositions) {
    const zona = Math.min(Math.floor((x / pageWidth) * zonas), zonas - 1);
    counts[zona]++;
  }
  
  // Se zona do meio tem poucos itens comparado às laterais, são 2 colunas
  const totalLaterais = counts[0] + counts[2];
  const meioVazio = counts[1] < totalLaterais * 0.3;
  
  return meioVazio ? 2 : 3;
}

// Extração para PDF de coluna única (layout simples)
function extrairTextoSimples(items: any[]): string {
  const linhas = agruparPorY(items);
  linhas.sort((a, b) => b.y - a.y);
  
  return linhas.map(linha => {
    linha.items.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
    return linha.items.map((item: any) => item.str).join(' ').trim();
  }).filter(l => l.length > 0).join('\n');
}

// Extração para PDF multicolunas (layout CNIS padrão)
function extrairTextoMulticolunas(items: any[], pageWidth: number, numColunas: number): string {
  const linhas = agruparPorY(items);
  linhas.sort((a, b) => b.y - a.y);
  
  const larguraColuna = pageWidth / numColunas;
  let resultado = '';

  for (const linha of linhas) {
    linha.items.sort((a: any, b: any) => a.transform[4] - b.transform[4]);
    
    // Separa itens por coluna
    const colunas: string[][] = Array.from({ length: numColunas }, () => []);
    
    for (const item of linha.items) {
      const x = item.transform[4];
      const col = Math.min(Math.floor(x / larguraColuna), numColunas - 1);
      colunas[col].push(item.str);
    }
    
    // Cada coluna vira uma linha separada
    for (const coluna of colunas) {
      const texto = coluna.join(' ').trim();
      if (texto) resultado += texto + '\n';
    }
  }

  return resultado;
}

// Agrupa itens com Y próximo (tolerância 3px)
function agruparPorY(items: any[]): { y: number, items: any[] }[] {
  const linhas: { y: number, items: any[] }[] = [];
  
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    const existingLine = linhas.find(l => Math.abs(l.y - y) < 3);
    
    if (existingLine) {
      existingLine.items.push(item);
    } else {
      linhas.push({ y, items: [item] });
    }
  }
  
  return linhas;
}
