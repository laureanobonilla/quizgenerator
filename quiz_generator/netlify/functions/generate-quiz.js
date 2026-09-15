const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { pdfText, userIdentifier } = data;

    if (!pdfText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el texto del PDF' }) };
    }

    const prompt = `A partir del siguiente texto extraído de un documento, genera estrictamente un objeto JSON válido con 4 cuestionarios de selección única, de 50 preguntas cada uno (Total 200 preguntas). 
    Los 4 niveles deben ser: "principiante", "intermedio", "avanzado", "experto".
    
    REQUISITO CRÍTICO DE CALIDAD: Las opciones incorrectas (distractores) deben ser altamente plausibles, basadas en errores conceptuales sutiles o confusiones comunes del texto, para que no sea fácil deducir la respuesta correcta por simple lógica o longitud.
    
    Texto de referencia:
    """
    ${pdfText.substring(0, 100000)}
    """

    El formato JSON de salida debe ser exactamente este, sin texto adicional fuera del JSON:
    {
      "principiante": [
        {
          "pregunta": "...",
          "opciones": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "respuestaCorrecta": 0,
          "explicacion": "..."
        }
      ],
      "intermedio": [...],
      "avanzado": [...],
      "experto": [...]
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    });

    const quizData = JSON.parse(response.text);

    // Guardar en JSONBin.io
    const jsonBinRes = await fetch('https://api.jsonbin.io/v3/b', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_MASTER_KEY,
        'X-Bin-Name': `Quiz_${userIdentifier || 'User'}_${Date.now()}`
      },
      body: JSON.stringify({
        createdAt: new Date().toISOString(),
        user: userIdentifier || 'Anónimo',
        quizzes: quizData
      })
    });

    const jsonBinResult = await jsonBinRes.json();

    if (!jsonBinRes.ok) {
      throw new Error('Error al guardar en JSONBin: ' + JSON.stringify(jsonBinResult));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        binId: jsonBinResult.metadata.id,
        message: 'Cuestionarios generados y guardados con éxito'
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
