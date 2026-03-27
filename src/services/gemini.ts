import { GoogleGenAI, Type } from "@google/genai";
import { CnisVinculo } from "../types";

const ai = (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) 
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export async function parseCnisText(text: string): Promise<{ nome?: string, vinculos: CnisVinculo[] }> {
  if (!ai) {
    console.warn("Gemini API Key is missing. AI parsing will not work.");
    return { vinculos: [] };
  }
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Você é um especialista em previdência brasileira. Extraia o nome do segurado e os vínculos e salários do seguinte texto de um extrato CNIS (Cadastro Nacional de Informações Sociais). 
            O texto pode vir de um PDF e conter ruídos de formatação. Foque em identificar:
            1. Nome Completo do Segurado/Contribuinte
            2. Nome da Empresa/Empregador
            3. Data de Início e Fim (se houver)
            4. Tipo de Vínculo (Empregado, Individual, etc)
            5. Se é atividade especial (insalubre/perigosa)
            6. Lista de salários por competência (Mês/Ano)

            Retorne um JSON seguindo exatamente esta estrutura:
            {
              nome: string (Nome completo do segurado),
              vinculos: Array<{
                empresa: string,
                inicio: string (ISO YYYY-MM-DD),
                fim?: string (ISO YYYY-MM-DD),
                tipo: "Empregado" | "Contribuinte Individual" | "Facultativo",
                especial: boolean,
                salarios: Array<{ competencia: string (YYYY-MM), valor: number }>
              }>
            }

            Texto do CNIS:
            ${text}`
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nome: { type: Type.STRING },
          vinculos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                empresa: { type: Type.STRING },
                inicio: { type: Type.STRING },
                fim: { type: Type.STRING },
                tipo: { 
                  type: Type.STRING,
                  enum: ["Empregado", "Contribuinte Individual", "Facultativo"]
                },
                especial: { type: Type.BOOLEAN },
                salarios: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      competencia: { type: Type.STRING },
                      valor: { type: Type.NUMBER }
                    },
                    required: ["competencia", "valor"]
                  }
                }
              },
              required: ["empresa", "inicio", "tipo", "especial", "salarios"]
            }
          }
        },
        required: ["nome", "vinculos"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '{"nome": "", "vinculos": []}');
    return {
      nome: data.nome,
      vinculos: (data.vinculos || []).map((v: any) => ({
        ...v,
        id: Math.random().toString(36).substr(2, 9)
      }))
    };
  } catch (e) {
    console.error("Erro ao parsear resposta do Gemini:", e);
    return { vinculos: [] };
  }
}
