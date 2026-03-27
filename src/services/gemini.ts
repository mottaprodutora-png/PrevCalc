import { GoogleGenAI, Type } from "@google/genai";
import { CnisVinculo } from "../types";

const apiKey = (typeof process !== 'undefined' && process.env.GEMINI_API_KEY);
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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
            text: `Você é um especialista em previdência brasileira (INSS). Sua tarefa é extrair o nome do segurado e todos os vínculos empregatícios e salários do texto de um extrato CNIS (Cadastro Nacional de Informações Sociais).

            O texto pode vir de um PDF e conter ruídos de formatação, tabelas quebradas e cabeçalhos repetidos. 
            Foque em identificar:
            1. Nome Completo do Segurado/Contribuinte (geralmente no topo do documento).
            2. Nome da Empresa/Empregador (ou NIT do empregador).
            3. Data de Início e Fim de cada vínculo.
            4. Tipo de Vínculo (Empregado, Contribuinte Individual, Facultativo, etc).
            5. Se é atividade especial (insalubre/perigosa) - procure por indicadores de tempo especial.
            6. Lista de salários por competência (Mês/Ano - ex: 01/2020) e o valor correspondente.

            REGRAS IMPORTANTES:
            - Se uma competência não tiver valor, ignore-a.
            - Se o vínculo não tiver data de fim, deixe o campo "fim" como null ou omitido.
            - Converta as datas para o formato ISO (YYYY-MM-DD).
            - Converta as competências para o formato YYYY-MM.
            - Se o texto estiver muito confuso, tente inferir os dados da melhor forma possível, mas não invente dados.

            Retorne um JSON seguindo exatamente esta estrutura:
            {
              "nome": "NOME COMPLETO",
              "vinculos": [
                {
                  "empresa": "NOME DA EMPRESA",
                  "inicio": "YYYY-MM-DD",
                  "fim": "YYYY-MM-DD" (ou null),
                  "tipo": "Empregado" | "Contribuinte Individual" | "Facultativo" | "Rural",
                  "especial": boolean,
                  "salarios": [
                    { "competencia": "YYYY-MM", "valor": 1234.56 }
                  ]
                }
              ]
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
                  enum: ["Empregado", "Contribuinte Individual", "Facultativo", "Rural"]
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

  console.log("Gemini Response Text:", response.text);

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
