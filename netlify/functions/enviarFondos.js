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
    const { celular, cantidad, id_pago } = JSON.parse(event.body);

    // Token de Mercado Pago según entorno
    const accessToken =
      process.env.NODE_ENV === "production"
        ? process.env.MP_TOKEN_PROD
        : process.env.MP_TOKEN_SANDBOX;

    // 🔍 Verificar el pago en Mercado Pago
    const respuesta = await axios.get(`https://api.mercadopago.com/v1/payments/${id_pago}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const pago = respuesta.data;

    if (pago.status !== 'approved') {
      return {
        statusCode: 200,
        body: JSON.stringify({ status: "pendiente", mensaje: `Pago con estado: ${pago.status}` }),
      };
    }

    // 📩 Datos del comprador desde Mercado Pago
    const email = pago.payer.email;
    const nombre = pago.payer.first_name || "";
    const apellido = pago.payer.last_name || "";

    // ✅ Validar monto pagado vs cantidad
    const cantidadEsperada = obtenerCantidadPorMonto(pago.transaction_amount);
    if (!cantidadEsperada) {
      return {
        statusCode: 400,
        body: JSON.stringify({ status: "error", mensaje: `Monto no válido: ${pago.transaction_amount}` }),
      };
    }

    if (cantidad !== cantidadEsperada) {
      return {
        statusCode: 400,
        body: JSON.stringify({ status: "error", mensaje: `Cantidad solicitada (${cantidad}) no coincide con el monto pagado (${pago.transaction_amount})` }),
      };
    }

    // 🔗 Conexión con Google Sheets
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

    // 📖 Leer los datos de la hoja
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:H`,
    });

    const fondos = data.values || [];
    const disponibles = fondos
      .map((row, index) => ({ row, index }))
      .filter(item => item.row[5] === 'disponible'); // Columna F = Estado

    if (disponibles.length < cantidad) {
      return { statusCode: 400, body: 'No hay suficientes fondos disponibles' };
    }

    // 🎲 Selección aleatoria
    const seleccionados = [];
    while (seleccionados.length < cantidad) {
      const i = Math.floor(Math.random() * disponibles.length);
      seleccionados.push(disponibles.splice(i, 1)[0]);
    }

    // ✍️ Actualizar en la hoja como vendidos y registrar comprador
    for (const fondo of seleccionados) {
      const fila = fondo.index + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!B${fila}:E${fila}`, // Correo, Celular, ID de pago, Nombre y Apellido
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[email, celular, id_pago, `${nombre} ${apellido}`]] },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!F${fila}`, // Estado
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['vendido']] },
      });
    }

    // 🔗 Construir enlaces para el correo
    const enlaces = seleccionados.map(f => f.row[7]).join('\n👉 '); // Columna H = Enlace

    const mensaje = `
Hola ${nombre} ${apellido},

🎉 ¡Gracias por tu compra de fondos digitales en Motofuria!

Aquí tienes los fondos que adquiriste. Descárgalos en los siguientes enlaces:
👉 ${enlaces}

📢 Además, únete a nuestro canal de Telegram para soporte y novedades:
👉 https://t.me/+1rRO36zXs0RjMmQ5

🙏 Gracias por participar en nuestra dinámica. ¡Recuerda que entre más compres, más cerca estás de ganar el premio!

👉 motofuria-fondos.netlify.app

Un abrazo del equipo Motofuria 🚀
`;

    // 📧 Configuración de correo
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
      statusCode: 500,
      body: JSON.stringify({ status: "error", mensaje: error.message }),
    };
  }
};
