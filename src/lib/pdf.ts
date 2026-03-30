import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Import the worker using Vite's ?url suffix to get a correct URL for the worker file
// This is the recommended way for Vite projects to handle workers from npm packages
// @ts-ignore - Vite specific import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    // Sort items by Y position (top to bottom) then X position (left to right)
    const items = textContent.items as any[];
    items.sort((a, b) => {
      if (Math.abs(a.transform[5] - b.transform[5]) < 5) {
        return a.transform[4] - b.transform[4];
      }
      return b.transform[5] - a.transform[5];
    });

    let pageText = '';
    let lastY = -1;
    for (const item of items) {
      if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += '\n';
      } else if (lastY !== -1) {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = item.transform[5];
    }
    fullText += pageText + '\n';
  }

  return fullText;
}
