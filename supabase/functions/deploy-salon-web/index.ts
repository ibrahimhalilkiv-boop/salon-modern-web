Deno.serve(()=>new Response("Deployment endpoint disabled",{status:410,headers:{"Cache-Control":"no-store"}}));
