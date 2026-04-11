import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");

export async function parseCnisText(text: string) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
  Analise este extrato do CNIS e retorne um JSON estruturado.
  REGRAS CRÍTICAS DE PRECISÃO:
  1. Siga rigorosamente a numeração de "Seq." (Sequência). 
  2. As "Remunerações" listadas após um vínculo pertencem EXCLUSIVAMENTE a esse vínculo até que uma nova "Seq." apareça.
  3. NÃO misture salários de empresas diferentes. Se o vínculo 5 é 'BRUNING', os salários abaixo dele são da 'BRUNING'.
  4. Identifique indicadores como 'PSC-MEN-SM-EC103' (Salário abaixo do mínimo) e marque-os no JSON.

  Retorne no formato:
  {
    "nome": "Nome do Segurado",
    "vinculos": [
      {
        "empresa": "Nome da Empresa",
        "dataInicio": "YYYY-MM-DD",
        "dataFim": "YYYY-MM-DD ou null",
        "tipo": "Empregado/Contribuinte Individual",
        "salarios": [{ "competencia": "MM/YYYY", "valor": 0.00, "indicadores": [] }]
      }
    ]
  }`;

  const result = await model.generateContent([prompt, text]);
  const response = await result.response;
  const jsonText = response.text().replace(/```json|```/g, "");
  return JSON.parse(jsonText);
}
