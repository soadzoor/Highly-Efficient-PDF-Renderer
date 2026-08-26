let sourceRootUrl = "";

export function initialize(data) {
  sourceRootUrl = String(data?.sourceRootUrl ?? "");
}

export async function resolve(specifier, context, nextResolve) {
  if (
    sourceRootUrl &&
    context.parentURL?.startsWith(sourceRootUrl) &&
    /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
