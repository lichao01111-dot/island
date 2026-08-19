import esbuild from 'esbuild';

const webOpts = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'web/main.js',
  sourcemap: 'inline',
};

function argValue(name) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

if (process.argv.includes('--serve')) {
  const ctx = await esbuild.context(webOpts);
  await ctx.watch();
  const port = Number(argValue('port') || process.env.PORT || 8002);
  const host = argValue('host') || '0.0.0.0';
  const served = await ctx.serve({ servedir: 'web', port, host });
  console.log(`dev server: http://${served.host}:${served.port}`);
} else {
  await esbuild.build(webOpts);
  console.log('built web/main.js');
}
