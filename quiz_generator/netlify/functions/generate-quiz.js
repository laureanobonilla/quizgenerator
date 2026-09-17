const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Valor por defecto si olvidas configurarla en Netlify

exports.handler = async function(event, context) {
  // Verificar contraseña de administrador
  if (event.httpMethod === 'PUT') {
    try {
      const data = JSON.parse(event.body);
      if (data.password === ADMIN_PASSWORD) {
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      }
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Contraseña incorrecta' }) };
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Solicitud inválida' }) };
    }
  }

  // Panel de administración: consultar acciones en columnas
  if (event.httpMethod === 'GET') {
    try {
      const res = await fetch('https://api.jsonbin.io/v3/b', {
        headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
      });
      const bins = await res.json();
      
      const logs = [];
      if (Array.isArray(bins)) {
        for (const b of bins) {
          try {
            const detailRes = await fetch(`https://api.jsonbin.io/v3/b/${b.record.id || b.id}/latest`, {
              headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
            });
            const detail = await detailRes.json();
            if (detail.record && detail.record.actionLog) {
              logs.push(detail.record);
            }
          } catch (e) {}
        }
      }

      logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return { statusCode: 200, body: JSON.stringify({ logs }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { topic, userIdentifier, selectedLevel } = data;

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

    let response = null;
    let attempts = 3;

    for (let i = 0; i < attempts; i++) {
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: fullPrompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.7
          }
        });
        break;
      } catch (err) {
        console.warn(`Intento ${i + 1} falló. Reintentando...`);
        await new Promise(res => setTimeout(res, 1500));
      }
    }

    if (!response) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Estamos dando mantenimiento en la app, por favor intente más tarde.' })
      };
    }

    const quizData = JSON.parse(response.text);

    try {
      await fetch('https://api.jsonbin.io/v3/b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_MASTER_KEY,
          'X-Bin-Name': `Log_${userIdentifier || 'User'}_${Date.now()}`
        },
        body: JSON.stringify({
          createdAt: new Date().toISOString(),
          actionLog: {
            user: userIdentifier || 'Anónimo',
            nivel: level,
            tema: topic
          }
        })
      });
    } catch (e) {
      console.warn('Error al registrar log de usuario (no crítico):', e);
    }

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
      body: JSON.stringify({ error: 'Estamos dando mantenimiento en la app, por favor intente más tarde.' })
    };
  }
};
