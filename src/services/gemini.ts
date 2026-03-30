import { CnisVinculo } from "../types";

export async function parseCnisText(text: string): Promise<{ nome?: string, vinculos: CnisVinculo[], error?: string }> {
  try {
    const response = await fetch("/api/parse-cnis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { vinculos: [], error: errorData.error || "SERVER_ERROR" };
    }

    const data = await response.json();
    return {
      nome: data.nome,
      vinculos: (data.vinculos || []).map((v: any) => ({
        ...v,
        id: Math.random().toString(36).substr(2, 9)
      }))
    };
  } catch (err: any) {
    console.error("Erro ao chamar API do servidor:", err);
    return { vinculos: [], error: err.message || "NETWORK_ERROR" };
  }
}
