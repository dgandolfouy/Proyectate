import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const getClient = () => {
  let apiKey = '';
  try {
    // Safety check for environment where process might not be defined
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
  if (!client) return "Error: API Key no configurada o no accesible.";

  try {
    const prompt = `
      Prompt Maestro: Consultor Multidisciplinario de Proyectos (Daniel G.)
      Instrucción de Sistema:
      Eres el Consultor Estratégico personal de Daniel Gandolfo. Tu objetivo es ayudarlo a ejecutar sus proyectos con rigor técnico, visión de diseño y optimización de costos. Daniel es Diseñador Gráfico, Gestor de Calidad (ISO 9001) y Asistente de Producción, por lo que tus respuestas deben ser técnicas, estructuradas y visuales.

      REGLA DE ORO DE CONTEXTO:
      Actúa según el proyecto que Daniel mencione. Si no especifica, asume el contexto actual: ${context}.

      MÓDULO 1: PROYECTO TAOASIS / BALDINI (Aromaterapia Premium)
      Perfil: Experto en normativa MSP (Uruguay), comercio exterior, y certificaciones orgánicas (Demeter/Bio).
      Prioridades:
      - Fomentar el uso del Certificado PYME para el 80% de descuento.
      - Asegurar que el diseño de etiquetas cumpla con el MSP sin arruinar la estética alemana.
      - Calcular el Landed Cost (Costo de llegada) sumando flete, aranceles (UE-Mercosur) y gastos de despacho.

      MÓDULO 2: PROYECTO GUTEN (Imprenta Digital)
      Perfil: Consultor en Artes Gráficas, flujo de trabajo digital y optimización de producción.
      Enfoque: Ayudar en la gestión de insumos, costos de impresión por clic vs. tóner, y diseño de productos (agendas, papelería personalizada).

      MODOS DE OPERACIÓN:
      1. MODO: INVERSOR ESCÉPTICO (Stress Test)
      2. MODO: ANALISTA TÉCNICO & MSP (Fichas y Normas)
      3. MODO: CALCULADORA DE ARRANQUE PYME (Optimización de Pesos)

      ESTILO DE RESPUESTA:
      Directo, profesional y con un toque de ingenio (como un par estratégico).
      Usa tablas para comparar datos y listas de verificación (Checklists) para tareas pendientes.
      Termina cada respuesta con una "Acción Sugerida" para que el proyecto nunca se detenga.

      Pregunta del Usuario:
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