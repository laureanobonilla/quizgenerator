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
    const { pdfText, userIdentifier, selectedLevel } = data;

    if (!pdfText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el texto del PDF' }) };
    }

    const level = selectedLevel || 'intermedio';

    const prompt = `A partir del siguiente texto extraído de un documento, genera estrictamente un objeto JSON válido con un cuestionario de selección única de 25 preguntas para el nivel: "${level}".
    
    REQUISITO CRÍTICO DE CALIDAD: Las opciones incorrectas (distractores) deben ser altamente plausibles, basadas en errores conceptuales sutiles o confusiones comunes del texto, para que no sea fácil deducir la respuesta correcta por lógica o longitud.
    
    Texto de referencia:
    """
    ${pdfText.substring(0, 100000)}
    """

    El formato JSON de salida debe ser exactamente este, sin texto adicional fuera del JSON:
    {
      "nivel": "${level}",
      "preguntas": [
        {
          "pregunta": "...",
          "opciones": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "respuestaCorrecta": 0,
          "explicacion": "..."
        }
      ]
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
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
        'X-Bin-Name': `Quiz_${level}_${userIdentifier || 'User'}_${Date.now()}`
      },
      body: JSON.stringify({
        createdAt: new Date().toISOString(),
        user: userIdentifier || 'Anónimo',
        nivel: level,
        quiz: quizData
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
        message: 'Cuestionario generado y guardado con éxito'
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
