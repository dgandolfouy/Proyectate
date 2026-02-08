import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const getClient = () => {
  let apiKey = '';
  try {
    if (typeof process !== 'undefined' && process.env) {
      apiKey = process.env.API_KEY || '';
    }
  } catch (e) {
    console.warn("Failed to access environment variables.");
  }

  if (!apiKey) {
    console.warn("Gemini API Key is missing.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getStrategicAdvice = async (
  context: string,
  question: string
): Promise<string> => {
  const client = getClient();
  if (!client) return "Error: API Key no configurada.";

  try {
    const prompt = `
      Prompt Maestro: Consultor Multidisciplinario (Daniel G.)
      
      CONTEXTO DEL PROYECTO:
      ${context}

      ROL:
      Eres un Project Manager Senior experto en economía, diseño y procesos (ISO 9001).
      
      TAREA:
      Responde a la siguiente consulta del usuario de forma breve, estratégica y orientada a la acción.
      
      CONSULTA:
      ${question}
    `;

    const response: GenerateContentResponse = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "No se pudo generar un consejo.";
  } catch (error) {
    console.error("Error fetching advice:", error);
    return "Ocurrió un error al consultar al asesor virtual.";
  }
};

export const generateTaskSuggestions = async (
  taskTitle: string,
  taskDescription: string,
  taskContext: string,
  projectTitle: string
): Promise<string> => {
  const client = getClient();
  if (!client) return "Configura tu API Key para recibir sugerencias.";

  try {
    const prompt = `
      ESTÁS DENTRO DE UNA TAREA ESPECÍFICA.
      Proyecto: ${projectTitle}
      Tarea: ${taskTitle}
      Descripción: ${taskDescription || "Sin descripción"}
      Contexto Adicional (Oculto): ${taskContext || "N/A"}

      OBJETIVO:
      Genera una lista de 3 a 5 "Siguientes Pasos" concretos y accionables para desbloquear o avanzar esta tarea.
      Si hay contexto técnico (ej: medidas, costos), úsalo para ser preciso.
      Formato: Markdown simple (lista con bullets). Sé breve.
    `;

    const response: GenerateContentResponse = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Sin sugerencias por el momento.";
  } catch (error) {
    return "Error al generar sugerencias.";
  }
};