const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');
const Busboy = require('busboy');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;

// Helper para parsear multipart/form-data en Netlify Functions
const parseMultipart = (event) => {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: { 'content-type': event.headers['content-type'] || event.headers['Content-Type'] } });
    let fileBuffer = [];
    let fields = {};

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      file.on('data', (data) => fileBuffer.push(data));
      file.on('end', () => {
        fields.fileData = Buffer.concat(fileBuffer);
      });
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('error', (error) => reject(error));
    busboy.on('finish', () => resolve(fields));

    busboy.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { fileData, userIdentifier } = await parseMultipart(event);

    if (!fileData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No se recibió ningún archivo PDF' }) };
    }

    const prompt = `Analiza el documento PDF adjunto y genera estrictamente un objeto JSON válido con 4 cuestionarios de selección única, de 50 preguntas cada uno (Total 200 preguntas). 
    Los 4 niveles deben ser: "principiante", "intermedio", "avanzado", "experto".
    
    REQUISITO CRÍTICO DE CALIDAD: Las opciones incorrectas (distractores) deben ser altamente plausibles, basadas en errores conceptuales sutiles o confusiones comunes del texto, para que no sea fácil deducir la respuesta correcta por simple lógica o longitud.
    
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
      contents: [
        {
          inlineData: {
            data: fileData.toString('base64'),
            mimeType: 'application/pdf'
          }
        },
        prompt
      ],
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
