async function main() {
  const { value } = await import('./lib/module');

  console.log(value);
}
main();
