const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Función para validar cantidad según monto pagado
function obtenerCantidadPorMonto(monto) {
  const paquetes = {
    11399: 3,
    22798: 6,
    34197: 9,
    68394: 18,
    102591: 27
  };
  return paquetes[monto] || null;
}

exports.handler = async function(event) {
  try {
    if (!event.body) {
      return { statusCode: 200, body: "Webhook recibido sin body" };
    }

    const body = JSON.parse(event.body);
    const id_pago = body.data?.id;

    // Si no viene id_pago
    if (!id_pago) {
      return { statusCode: 200, body: "Webhook recibido sin id_pago" };
    }

    // Si es un webhook de prueba (ejemplo de Mercado Pago)
    if (id_pago === "123456") {
      return { statusCode: 200, body: "Webhook de prueba recibido correctamente ✅" };
    }

    const accessToken = process.env.MP_TOKEN_PROD;

    // Llamar a la API de Mercado Pago
    let pago;
    try {
      const respuesta = await axios.get(
        `https://api.mercadopago.com/v1/payments/${id_pago}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      pago = respuesta.data;
    } catch (err) {
      return { statusCode: 200, body: `No se encontró el pago con ID ${id_pago}` };
    }

    if (pago.status !== 'approved') {
      return { statusCode: 200, body: `Pago en estado: ${pago.status}` };
    }

    const cantidad = obtenerCantidadPorMonto(pago.transaction_amount);
    if (!cantidad) {
      return { statusCode: 200, body: `Monto no válido: ${pago.transaction_amount}` };
    }

    const email = pago.payer.email;
    const nombre = pago.payer.first_name || "";
    const apellido = pago.payer.last_name || "";
    const celular = pago.payer.identification?.number || "no-reg";

    // Autenticación con Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '17xDKkY3jnkMjBgePAiUBGmHgv4i6IMxU7iWFCiyor1k';
    const sheetName = 'fondos';

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:H`,
    });

    const fondos = data.values || [];
    const disponibles = fondos
      .map((row, index) => ({ row, index }))
      .filter(item => item.row[5] === 'disponible');

    if (disponibles.length < cantidad) {
      return { statusCode: 200, body: 'No hay suficientes fondos disponibles' };
    }

    // Seleccionar fondos aleatorios
    const seleccionados = [];
    while (seleccionados.length < cantidad) {
      const i = Math.floor(Math.random() * disponibles.length);
      seleccionados.push(disponibles.splice(i, 1)[0]);
    }

    // Actualizar Google Sheets
    for (const fondo of seleccionados) {
      const fila = fondo.index + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!B${fila}:E${fila}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[email, celular, id_pago, `${nombre} ${apellido}`]] },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!F${fila}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['vendido']] },
      });
    }

    // Construir enlaces
    const enlaces = seleccionados.map(f => f.row[7]).join('\n👉 ');

    // Mensaje del correo
    const mensaje = `
Hola ${nombre} ${apellido},

🎉 ¡Gracias por tu compra de fondos digitales en Motofuria! Aquí tienes los fondos que adquiriste. Descárgalos en los siguientes enlaces:
👉 ${enlaces}

📢 Únete a nuestro canal de Telegram para soporte y novedades:
👉 https://t.me/+1rRO36zXs0RjMmQ5

👉 motofuria-fondos.netlify.app

Un abrazo del equipo Motofuria 🚀
`;

    // Enviar correo
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.CORREO_MOTOFURIA,
        pass: process.env.CLAVE_CORREO,
      },
    });

    await transporter.sendMail({
      from: 'Motofuria <motofuria@correo.com>',
      to: email,
      subject: '🎉 Tus fondos digitales de Motofuria',
      text: mensaje,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: "ok", mensaje: "Fondos asignados y correo enviado ✅" }),
    };

  } catch (error) {
    return {
      statusCode: 200, // ⚠️ siempre 200 para que Mercado Pago no corte el webhook
      body: JSON.stringify({ status: "error", mensaje: error.message }),
    };
  }
};

