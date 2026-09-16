const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { topic, selectedLevel } = data;

    if (!topic) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Debes proporcionar un tema' }) };
    }

    const level = selectedLevel || 'intermedio';
    const randomSeed = Date.now();

    const fullPrompt = `Genera estrictamente un objeto JSON válido con un cuestionario de selección única de 5 preguntas sobre el tema: "${topic}" para el nivel: "${level}".
    
    INSTRUCCIÓN DE VARIABILIDAD (Seed: ${randomSeed}): 
    Varía radicalmente el enfoque y los aspectos evaluados en comparación con evaluaciones convencionales de este mismo tema.
    
    REQUISITO CRÍTICO: Las opciones incorrectas (distractores) deben ser altamente plausibles, basadas en errores conceptuales sutiles. 
    Además, incluye para cada pregunta un campo llamado "ampliacionConocimiento" que aporte un dato cultural, histórico o científico avanzado relacionado con la respuesta correcta pero que esté más allá de los fundamentos básicos.
    
    El formato JSON de salida debe ser exactamente este:
    {
      "nivel": "${level}",
      "preguntas": [
        {
          "pregunta": "...",
          "opciones": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "respuestaCorrecta": 0,
          "explicacion": "...",
          "ampliacionConocimiento": "..."
        }
      ]
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: fullPrompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    });

    const quizData = JSON.parse(response.text);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        quizData: quizData
      })
    };

  } catch (error) {
    console.error('Error detallado:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
