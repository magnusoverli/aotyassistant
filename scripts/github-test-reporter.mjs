// Node test reporter for CI: each failing test becomes a GitHub error annotation.
// Annotations appear on the run page and in the public API, unlike job logs.
import { relative } from 'node:path';

const data = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const property = value => data(value).replaceAll(':', '%3A').replaceAll(',', '%2C');

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const error = event.data.details?.error; const cause = error?.cause ?? error;
    const file = event.data.file ? `file=${property(relative(process.cwd(), event.data.file).replaceAll('\\', '/'))},line=${event.data.line ?? 1},` : '';
    yield `::error ${file}title=${property(event.data.name)}::${data(cause?.message ?? 'Test failed').slice(0, 4000)}\n`;
  }
}
