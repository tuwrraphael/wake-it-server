self.RESOLVED_SET_ALARM = self.RESOLVED_SET_ALARM || { "test": false };

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})
/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
  let url = new URL(request.url);
  if (url.pathname === "/firebase-token" && request.method == "POST") {
    let idToken = request.headers.get("Authorization");
    let userId;
    try {
      let res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken.replace("Bearer ", "")}`);
      if (!res.ok) {
        throw new Error(`id token validation resulted in ${res.status}`);
      }
      let body = (await res.json());
      if (body.aud != ANDROID_AUD) {
        throw new Error(`audience mismatch`);
      }
      if (new Date(body.exp * 1000) < new Date()) {
        throw new Error(`id token expired`);
      }
      userId = body.sub;
    }
    catch (err) {
      console.error("id token validation failure", err);
      return new Response("id token validation failure", {
        headers: { 'content-type': 'text/plain' },
        status: 500
      });
    }
    await WAKE_IT.put(`fb-${userId}`, await request.text());
    return new Response("OK", { headers: { 'content-type': 'text/plain' } });
  }
  else if (url.pathname === "/set-alarm" && request.method == "PUT") {
    let alarmdata = await request.json();
    let accesstoken = request.headers.get("Authorization").replace("Bearer ", "");
    let userId;
    try {
      let res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accesstoken}`);
      if (!res.ok) {
        throw new Error(`access token validation resulted in ${res.status}`);
      }
      let body = (await res.json());
      if (body.aud != ALEXA_AUD) {
        throw new Error(`audience mismatch`);
      }
      if (new Date(body.exp * 1000) < new Date()) {
        throw new Error(`access token expired`);
      }
      userId = body.sub;
    }
    catch (err) {
      console.error("access token validation failure", err);
      return new Response("access token validation failure", {
        headers: { 'content-type': 'text/plain' },
        status: 500
      });
    }

    let fbToken = await WAKE_IT.get(`fb-${userId}`);
    if (fbToken) {
      await fetch(KV_ADDRESS, {
        method: "POST", headers: {
          "Content-Type": "text/plain",
        }, body: "false"
      });
      let res = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST", headers: {
          "Content-Type": "application/json",
          "Authorization": `key=${FIREBASE_REGKEY}`
        }, body: JSON.stringify({
          to: fbToken,
          priority: 10,
          data: {
            "set-alarm-id": userId,
            "hours": "" + alarmdata.hours,
            "minutes": "" + alarmdata.minutes
          }
        })
      });
      if (!res.ok) {
        return new Response("FCM error", { headers: { 'content-type': 'text/plain' }, status: 500 });
      } else {
        let time = +new Date();
        let p = new Promise((resolve) => {
          let cb = () => {
            fetch(KV_ADDRESS)
              .then(res => res.text())
              .then(r => {
                if (r.startsWith(userId)) {
                  console.log("istrue");
                  resolve(true);
                }
                else if ((+new Date() - time) > 5000) {
                  resolve(false);
                } else {
                  setTimeout(cb, 1000);
                }
              });
          };
          setTimeout(cb, 1000);
        });
        let res = await p;
        if (res) {
          return new Response("Created", { headers: { 'content-type': 'text/plain' }, status: 201 });
        }
        else {
          return new Response("Found, but timeout", { headers: { 'content-type': 'text/plain' }, status: 200 });
        }
      }
    } else {
      return new Response("Not Found", { headers: { 'content-type': 'text/plain' }, status: 404 });
    }
  }
  else if (url.pathname === "/alarm-confirmation" && request.method == "PUT") {
    let id = await request.text();
    await fetch(KV_ADDRESS, {
      method: "POST", headers: {
        "Content-Type": "text/plain",
      }, body: id
    });
    return new Response('OK', {
      headers: { 'content-type': 'text/plain' }
    });
  }
  return new Response('Not found', {
    headers: { 'content-type': 'text/plain' },
    status: 404,
    statusText: "Not Found"
  });
}
