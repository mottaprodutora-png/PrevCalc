import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Gemini API Setup
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  // API Routes
  app.post("/api/parse-cnis", async (req, res) => {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Texto não fornecido" });
    }

    if (!ai) {
      console.error("GEMINI_API_KEY não configurada no servidor");
      return res.status(500).json({ error: "API_KEY_MISSING" });
    }

    try {
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
                2. Nome da Empresa/Empregador (ou NIT do empregador).
                3. Data de Início e Fim de cada vínculo.
                4. Tipo de Vínculo (Empregado, Contribuinte Individual, Facultativo, Especial, Rural, etc).
                5. Se é atividade especial (insalubre/perigosa) - procure por indicadores de tempo especial ou códigos de agentes nocivos.
                6. Lista de salários por competência (Mês/Ano - ex: 01/2020) e o valor correspondente.

                REGRAS IMPORTANTES:
                - Se uma competência não tiver valor, ignore-a.
                - Se o vínculo não tiver data de fim, deixe o campo "fim" como null ou omitido.
                - Converta as datas para o formato ISO (YYYY-MM-DD).
                - Converta as competências para o formato YYYY-MM.
                - Se o texto estiver muito confuso, tente inferir os dados da melhor forma possível, mas não invente dados.
                - Se o tipo de vínculo for "Empregado ou Agente Público", classifique como "Empregado".
                - Se o tipo de vínculo for "Contribuinte Individual", classifique como "Contribuinte Individual".
                - Extraia o máximo de vínculos possível. Não pare no primeiro.

                Retorne um JSON seguindo exatamente esta estrutura:
                {
                  "nome": "NOME COMPLETO",
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
      res.json(data);
    } catch (error: any) {
      console.error("Erro no processamento Gemini:", error);
      res.status(500).json({ error: error.message || "Erro interno no servidor" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
