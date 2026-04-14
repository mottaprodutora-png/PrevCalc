import { GoogleGenAI, Type } from "@google/genai";
import { CnisVinculo } from "../types";

export async function parseCnisText(text: string): Promise<{ nome?: string, dataNascimento?: string, vinculos: CnisVinculo[], error?: string }> {
  try {
    // The Gemini API key is already set in the environment.
    let apiKey = process.env.GEMINI_API_KEY;
    
    // Clean up the key (sometimes it might have quotes or whitespace from env injection)
    if (apiKey) {
      apiKey = apiKey.trim().replace(/^["']|["']$/g, '');
    }
    
    if (!apiKey || apiKey === "TODO_KEYHERE" || apiKey.includes("TODO") || apiKey.length < 10) {
      return { vinculos: [], error: "API_KEY_MISSING" };
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Você é um especialista em previdência brasileira (INSS). Sua tarefa é extrair o nome do segurado e TODOS os vínculos empregatícios e salários do texto de um extrato CNIS (Cadastro Nacional de Informações Sociais).

              O texto pode vir de um PDF e conter ruídos de formatação, tabelas quebradas e cabeçalhos repetidos. 
              Foque em identificar:
              1. Nome Completo do Segurado/Contribuinte (geralmente no topo do documento).
              2. Data de Nascimento do Segurado (geralmente no topo do documento).
              3. Nome da Empresa/Empregador (ou NIT do empregador).
              4. Data de Início e Fim de cada vínculo.
              5. Tipo de Vínculo (Empregado, Contribuinte Individual, Facultativo, Especial, Rural, etc).
              6. Se é atividade especial (insalubre/perigosa) - procure por indicadores de tempo especial ou códigos de agentes nocivos.
              7. Lista de salários por competência (Mês/Ano - ex: 01/2020) e o valor correspondente.

              REGRAS IMPORTANTES:
              - Se uma competência não tiver valor, ignore-a.
              - Se o vínculo não tiver data de fim, deixe o campo "fim" como null ou omitido.
              - Converta as datas para o formato ISO (YYYY-MM-DD).
              - Converta as competências para o formato YYYY-MM.
              - Se o texto estiver muito confuso, tente inferir os dados da melhor forma possível, mas não invente dados.
              - Se o tipo de vínculo for "Empregado ou Agente Público", classifique como "Empregado".
              - Se o tipo de vínculo for "Contribuinte Individual", classifique como "Contribuinte Individual".
              - Extraia o máximo de vínculos possível. Não pare no primeiro.
              - IMPORTANTE: A data de nascimento do segurado NÃO deve ser usada como data de início de um vínculo, a menos que seja explicitamente indicado que o trabalho começou no dia do nascimento (o que é impossível).

              Retorne um JSON seguindo exatamente esta estrutura:
              {
                "nome": "NOME COMPLETO",
                "dataNascimento": "YYYY-MM-DD",
                "vinculos": [
                  {
                    "empresa": "NOME DA EMPRESA",
                    "inicio": "YYYY-MM-DD",
                    "fim": "YYYY-MM-DD" (ou null),
                    "tipo": "Empregado" | "Contribuinte Individual" | "Facultativo" | "Especial" | "Rural",
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
            dataNascimento: { type: Type.STRING },
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
                    enum: ["Empregado", "Contribuinte Individual", "Facultativo", "Especial", "Rural"]
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
                required: ["empresa", "inicio", "tipo", "especial"]
              }
            }
          },
          required: ["nome", "vinculos"]
        }
      }
    });

    const data = JSON.parse(response.text || '{"nome": "", "vinculos": []}');
    
    return {
      nome: data.nome,
      dataNascimento: data.dataNascimento,
      vinculos: (data.vinculos || []).map((v: any) => ({
        ...v,
        id: Math.random().toString(36).substr(2, 9)
      }))
    };
  } catch (err: any) {
    console.error("Erro no processamento Gemini:", err);
    return { vinculos: [], error: err.message || "GEMINI_ERROR" };
  }
}
