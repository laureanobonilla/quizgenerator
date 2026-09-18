const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

exports.handler = async function(event, context) {
  // Manejo de peticiones PUT (Admin o Canje de Llave Maestra / Regalo)
  if (event.httpMethod === 'PUT') {
    try {
      const data = JSON.parse(event.body);
      
      // 1. Verificación de contraseña de administrador para abrir el panel
      if (data.action === 'verifyAdmin') {
        if (data.password === ADMIN_PASSWORD) {
          return { statusCode: 200, body: JSON.stringify({ success: true }) };
        }
        return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Contraseña incorrecta' }) };
      }

      // 2. Canjear Llave Maestra / Regalo en el campo de nombre
      if (data.action === 'redeemGiftKey') {
        const { giftKey, deviceId } = data;
        if (!giftKey || !deviceId) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Datos incompletos' }) };
        }

        const cleanKey = giftKey.trim().toUpperCase();

        // Buscar en JSONBin si existe la llave de regalo
        const res = await fetch('https://api.jsonbin.io/v3/b', {
          headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
        });
        const bins = await res.json();
        
        let keyFound = false;
        let alreadyUsedByOther = false;

        if (Array.isArray(bins)) {
          for (const b of bins) {
            try {
              const detailRes = await fetch(`https://api.jsonbin.io/v3/b/${b.record.id || b.id}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
              });
              const detail = await detailRes.json();
              
              if (detail.record && detail.record.giftKey && detail.record.giftKey === cleanKey) {
                keyFound = true;
                if (detail.record.usedByDevice && detail.record.usedByDevice !== deviceId) {
                  alreadyUsedByOther = true;
                } else {
                  // Casar la llave con este dispositivo permanentemente
                  await fetch(`https://api.jsonbin.io/v3/b/${b.record.id || b.id}`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Master-Key': JSONBIN_MASTER_KEY
                    },
                    body: JSON.stringify({
                      ...detail.record,
                      usedByDevice: deviceId,
                      activatedAt: new Date().toISOString()
                    })
                  });
                }
                break;
              }
            } catch (e) {}
          }
        }

        if (!keyFound) {
          return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Llave maestra inválida.' }) };
        }
        if (alreadyUsedByOther) {
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Esta llave ya fue utilizada en otro dispositivo.' }) };
        }

        return { statusCode: 200, body: JSON.stringify({ success: true, message: '¡Llave activada con éxito!' }) };
      }

      return { statusCode: 400, body: JSON.stringify({ error: 'Acción no válida' }) };
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
    }
  }

  // Panel de administración: consultar logs y llaves creadas
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
            if (detail.record && (detail.record.actionLog || detail.record.giftKey)) {
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

  // POST: Generar Quiz o Crear una Nueva Llave de Regalo (Admin)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    // Si la petición es para crear una nueva llave de regalo
    if (data.createGiftKey) {
      const customKey = (data.keyName || ('REGALO-' + Math.random().toString(36).substring(2, 8))).toUpperCase();
      await fetch('https://api.jsonbin.io/v3/b', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_MASTER_KEY,
          'X-Bin-Name': `GiftKey_${customKey}`
        },
        body: JSON.stringify({
          createdAt: new Date().toISOString(),
          giftKey: customKey,
          usedByDevice: null,
          note: data.note || 'Llave de regalo'
        })
      });
      return { statusCode: 200, body: JSON.stringify({ success: true, key: customKey }) };
    }

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
    } catch (e) {}

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
