Deno.serve(() => new Response(
  "Online randevu geÃ§ici olarak kapalÄ±dÄ±r. Salon Modern uygulamasÄ±nÄ±n v1.5.9 sÃ¼rÃ¼mÃ¼ aktiftir.",
  {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  },
));
