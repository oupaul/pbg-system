// （測試專用，只注入到複製出來的 app.js）列出所有已註冊的路由：{ method, path }
app.get('/__test/routes', (req, res) => {
  const out = [];
  const splitPath = (layer) => {
    if (layer.regexp && layer.regexp.fast_slash) return '';
    const m = layer.regexp.toString().replace('\\/?', '').replace('(?=\\/|$)', '$')
      .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^.*+?^${}()|[\]\\\/])*)\$\//);
    return m ? m[1].replace(/\\(.)/g, '$1') : '<complex>';
  };
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
        }
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, prefix + splitPath(layer));
      }
    }
  };
  walk(app._router.stack, '');
  res.json(out);
});
