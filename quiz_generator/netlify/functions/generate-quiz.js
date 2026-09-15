const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;

exports.handler = async function(event, context) {
  // Manejar consulta de historial por GET
  if (event.httpMethod === 'GET') {
    const user = event.queryStringParameters.user;
    if (!user) return { statusCode: 400, body: JSON.stringify({ error: 'Falta usuario' }) };

    try {
      // Listar bins públicos/privados de JSONBin
      const res = await fetch('https://api.jsonbin.io/v3/b', {
        headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
      });
      const bins = await res.json();
      
      // Filtrar los bins del usuario actual
      const userBins = [];
      if (Array.isArray(bins)) {
        for (const b of bins) {
          try {
            const detailRes = await fetch(`https://api.jsonbin.io/v3/b/${b.record.id || b.id}/latest`, {
              headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
            });
            const detail = await detailRes.json();
            if (detail.record && detail.record.user && detail.record.user.toLowerCase() === user.toLowerCase()) {
              userBins.push(detail.record);
            }
          } catch (e) {}
        }
      }

      return { statusCode: 200, body: JSON.stringify({ quizzes: userBins }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

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
    const optimizedText = pdfText.substring(0, 15000);

    const prompt = `A partir del siguiente extracto de texto, genera estrictamente un objeto JSON válido con un cuestionario de selección única de 5 preguntas para el nivel: "${level}".
    
    REQUISITO CRÍTICO DE CALIDAD: Las opciones incorrectas (distractores) deben ser altamente plausibles, basadas en errores conceptuales sutiles. 
    Además, incluye para cada pregunta un campo llamado "ampliacionConocimiento" que aporte un dato cultural, histórico o científico avanzado relacionado con la respuesta correcta pero que esté FUERA del libro de texto.
    
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
      contents: [prompt, optimizedText],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    });

    const quizData = JSON.parse(response.text);

    // Guardar en JSONBin.io vinculado al usuario
    const recordToSave = {
      createdAt: new Date().toISOString(),
      user: userIdentifier || 'Anónimo',
      quiz: quizData
    };

    await fetch('https://api.jsonbin.io/v3/b', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_MASTER_KEY,
        'X-Bin-Name': `Quiz_${level}_${userIdentifier || 'User'}_${Date.now()}`
      },
      body: JSON.stringify(recordToSave)
    });

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
