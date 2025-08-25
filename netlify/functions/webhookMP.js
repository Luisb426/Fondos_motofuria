export async function handler(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    console.log("Webhook recibido:", body);

    const paymentId = body.data?.id;
    const ACCESS_TOKEN = "TEST-xxxxxxxxxxxxxxxx"; // tu token de MP

    if (paymentId) {
      const response = await fetch(https://api.mercadopago.com/v1/payments/${paymentId}, {
        headers: {
          Authorization: Bearer ${ACCESS_TOKEN},
        },
      });

      const paymentData = await response.json();
      console.log("Detalles del pago:", paymentData);

      // Aquí deberías guardar en una base de datos externa (ej: Supabase, Railway, PlanetScale, MySQL remoto, etc.)
      // Netlify por sí solo no trae MySQL local.

      return { statusCode: 200, body: "OK" };
    } else {
      return { statusCode: 400, body: "No payment ID" };
    }
  } catch (error) {
    console.error("Error en webhook:", error);
    return { statusCode: 500, body: "Server error" };
  }
}
