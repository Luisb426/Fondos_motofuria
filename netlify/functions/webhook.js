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

exports.handler = async function (event) {
  try {
    // ✅ Evita error si el body viene vacío
    if (!event.body) {
      return { statusCode: 400, body: "Sin body recibido" };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (err) {
      return { statusCode: 400, body: "Body no es JSON válido" };
    }

    const id_pago = body.data?.id;
    if (!id_pago) {
      return { statusCode: 400, body: "ID de pago no recibido" };
    }

    const accessToken = process.env.MP_TOKEN_PROD;

    // ✅ Obtener pago de Mercado Pago
    const respuesta = await axios.get(
      `https://api.mercadopago.com/v1/payments/${id_pago}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const pago = respuesta.data;
    if (pago.status !== 'approved') {
      return { statusCode: 200, body: `Pago en estado: ${pago.status}` };
    }

    const cantidad = obtenerCantidadPorMonto(Math.round(pago.transaction_amount));
    if (!cantidad) {
      return { statusCode: 400, body: `Monto no válido: ${pago.transaction_amount}` };
    }

    const email = pago.payer?.email || "sin-email";
    const nombre = pago.payer?.first_name || "";
    const apellido = pago.payer?.last_name || "";
    const celular = pago.payer?.identification?.number || "no-reg";

    // ✅ Autenticación con Google Sheets
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        // Reemplazo de saltos de línea para que no explote
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '17xDKkY3jnkMjBgePAiUBGmHgv4i6IMxU7iWFCiyor1k';
    const sheetName = 'fondos';

    // ✅ Obtener valores
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:H`,
    });

    const fondos = data.values || [];
    const disponibles = fondos
      .map((row, index) => ({ row, index }))
      .filter(item => item.row[5] === 'disponible');

    if (disponibles.length < cantidad) {
      return { statusCode: 400, body: 'No hay suficientes fondos disponibles' };
    }

    // Seleccionar fondos aleatorios
    const seleccionados = [];
    while (seleccionados.length < cantidad) {
      const i = Math.floor(Math.random() * disponibles.length);
      seleccionados.push(disponibles.splice(i, 1)[0]);
    }

    // ✅ Actualizar Google Sheets
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

    // Construir lista de enlaces
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

    // ✅ Enviar correo
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
    console.error("❌ Error en webhook:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: "error", mensaje: error.message }),
    };
  }
};
