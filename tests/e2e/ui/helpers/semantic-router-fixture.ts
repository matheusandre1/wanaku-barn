import type { Page, Route } from '@playwright/test';
import type { SemanticAction, SemanticExpert, SemanticGuard, SemanticPreview, SemanticPublishedGuard, SemanticFieldError, SemanticPublication, SemanticRouterDefinition } from '../../../../apps/ui/admin/src/models';


function guardParameterErrors(guard: SemanticGuard | null | undefined, experts: Map<string, SemanticExpert>): SemanticFieldError[] {
  if (!guard) return [];
  const operation = experts.get(guard.expertId ?? '')?.operations?.find(item => item.name === guard.operation);
  const properties = operation?.parameterSchema?.properties as Record<string, { type?: string }> | undefined;
  return Object.entries(properties ?? {}).flatMap(([name, property]) => {
    const value = guard.parameters?.[name];
    if (value === undefined) return [];
    const invalidObject = property.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value));
    const invalidArray = property.type === 'array' && !Array.isArray(value);
    return invalidObject || invalidArray ? [{ field: 'guard.parameters', message: 'Guard parameters do not match the operation schema' }] : [];
  });
}

function publishedGuard(guard: SemanticGuard | null | undefined, experts: Map<string, SemanticExpert>): SemanticPublishedGuard | undefined {
  if (!guard) return undefined;
  return { ...guard, expert: experts.get(guard.expertId ?? '') };
}

async function expertRequest(route: Route, experts: Map<string, SemanticExpert>, definitions: Map<string, SemanticRouterDefinition>, requests: string[]) {
  const request = route.request();
  const json = (data: unknown) => route.fulfill({ json: { data } });
  const conflict = (message: string) => route.fulfill({ status: 409, json: { error: { message } } });
  const path = new URL(request.url()).pathname.replace('/api/v1/semantic-routers', '');
  const parts = path.split('/').filter(Boolean);
  requests.push(`${request.method()} ${path}`);
  if (request.method() === 'GET') return json(parts.length === 1 ? [...experts.values()] : experts.get(parts[1]));
  if (request.method() === 'DELETE') {
    const referenced = [...definitions.values()].some(definition => definition.expertId === parts[1] || definition.guard?.expertId === parts[1]);
    if (referenced) return conflict('Expert is referenced by a draft');
    experts.delete(parts[1]); return json(null);
  }
  const entry = request.postDataJSON() as SemanticExpert;
  const duplicate = experts.has(entry.id!) || [...experts.values()].some(item => item.bean === entry.bean);
  if (request.method() === 'POST' && duplicate) return conflict('Expert ID or bean already exists');
  experts.set(entry.id!, entry); return json(entry);
}

function previewResult(message: string, guard: SemanticGuard | null | undefined): SemanticPreview {
  const guardValue = message.includes('injection');
  const blocked = Boolean(guard && guardValue === (guard.rejectWhen ?? true));
  const guardError = guard && message.includes('guard_error') ? 'Guard evaluation failed' : null;
  const error = guardError ?? (message.includes('provider_error') ? 'Expert provider is unavailable' : message.includes('malformed') ? 'Malformed expert decision' : null);
  const label = message.toLowerCase().includes('invoice') ? 'wsr_billing_action' : message.toLowerCase().includes('software') ? 'wsr_technical_action' : null;
  return { label: blocked || error ? null : label, blocked: !error && blocked,
    guard: guard && !guardError ? { value: guardValue, diagnostics: {} } : null,
    noMatch: !blocked && !error && !label, error, durationMillis: 5, diagnostics: {} };
}

/** Deterministic HTTP fixture for browser behavior. Native execution is covered by backend/runtime tests. */
export async function semanticRouterFixture(page: Page, catalog?: (defaults: SemanticAction[], definitionId?: string) => SemanticAction[]) {
  const definitions = new Map<string, SemanticRouterDefinition>();
  const publications = new Map<string, SemanticPublication[]>();
  const currentPublications = new Map<string, string>();
  const resolutionErrors = new Map<string, number>();
  const resolutions: string[] = [];
  const actionRequests: (string | undefined)[] = [];
  const previews: string[] = [];
  const fileRequests: SemanticRouterDefinition[] = [];
  const fileStatuses: number[] = [];
  const saves: SemanticRouterDefinition[] = [];
  const publishRequests: string[] = [];
  const expert: SemanticExpert = {
    id: 'support', name: 'Support expert', bean: 'supportExpert',
    dependency: 'org.apache.camel:camel-typesafe-ai:4.23.0-SNAPSHOT', supportsConfidence: false,
  };
  const experts = new Map<string, SemanticExpert>([[expert.id!, expert]]);
  const expertRequests: string[] = [];
  const actions: SemanticAction[] = ['billing', 'technical'].map(kind => ({
    id: `wsr-${kind}-action`, sha256: (kind === 'billing' ? 'b' : 'c').repeat(64), current: true, name: `${kind === 'billing' ? 'Billing' : 'Technical'} support`,
    description: `Handle ${kind} requests`, criteria: `${kind} questions`, profile: 'message-to-string/v1',
    inputSchema: { type: 'string' }, outputSchema: { type: 'string' }, dependencies: ['camel:core'],
    configurationSchema: { type: 'object', required: ['prefix'], properties: {
      prefix: { type: 'string', title: 'Response prefix', default: 'Support', minLength: 1 },
      credentialRef: { type: 'string', title: 'Credential reference', 'x-secret-reference': true },
    } },
  }));
  actions.push({ ...actions[0], id: 'incompatible', name: 'Incompatible action', profile: 'other/v1' });
  const validate = (definition: SemanticRouterDefinition, draft: boolean): SemanticFieldError[] => {
    const errors: SemanticFieldError[] = [];
    for (const [field, limit] of [['name', 120], ['toolName', 64]] as const) {
      const value = definition[field];
      if (value && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
        errors.push({ field, message: 'Start with a letter. Use only letters, digits, hyphens, and underscores; do not use spaces.' });
      }
      if (value && value.length > limit) errors.push({ field, message: `Value must not exceed ${limit} characters` });
    }
    if (!draft) {
      for (const field of ['name', 'description', 'toolName', 'expertId', 'instructions', 'noMatchCriteria'] as const) {
        if (!definition[field]?.trim()) errors.push({ field, message: 'Value is required' });
      }
      if ((definition.actions?.length ?? 0) < 2) errors.push({ field: 'actions', message: 'Select at least two actions' });
    }
    errors.push(...guardParameterErrors(definition.guard, experts));
    const available = catalog ? catalog(actions, definition.id) : actions;
    definition.actions?.forEach((action, index) => {
      const schema = available.find(candidate => candidate.id === action.actionId &&
        (!action.sha256 || candidate.sha256 === action.sha256))?.configurationSchema;
      const required = Array.isArray(schema?.required) ? schema.required : [];
      const properties = schema?.properties as Record<string, { title?: string; 'x-secret-reference'?: boolean }> | undefined;
      for (const [name, property] of Object.entries(properties ?? {})) {
        const value = action.configuration?.[name];
        const field = `actions[${index}].configuration.${name}`;
        if (!draft && required.includes(name) && !value) errors.push({ field, message: `${property.title ?? name} is required` });
        if (property['x-secret-reference'] && value && !/^env:[A-Z_][A-Z0-9_]*$/.test(value)) {
          errors.push({ field, message: 'Use an environment reference' });
        }
      }
    });
    return errors;
  };
  const generatedFiles = (definition: SemanticRouterDefinition): Record<string, string> => {
    const selectedExpert = experts.get(definition.expertId ?? '') ?? expert;
    const guardExpert = publishedGuard(definition.guard, experts)?.expert;
    const question = `- semantic:\n    question:\n      department:\n        type: choice\n        state: \"\${body}\"\n        instructions: ${JSON.stringify(definition.instructions)}\n        expert: ${selectedExpert.bean}\n        criteria:\n${(definition.actions ?? []).map(action => `          ${action.label}: ${JSON.stringify(action.criteria)}\n`).join('')}          no_match: ${JSON.stringify(definition.noMatchCriteria)}\n`;
    const classify = '- route:\n    id: router-classification\n    from:\n      uri: direct:classify-router\n      steps:\n        - setProperty:\n            name: department\n            expression:\n              language:\n                language: semantic\n                expression: ref:department\n';
    const dispatch = `- route:\n    id: router-dispatch\n    from:\n      uri: direct:dispatch-router\n      steps:\n        - to: direct:classify-router\n        - choice:\n            when:\n${(definition.actions ?? []).map(action => `              - simple: \"\${exchangeProperty.department} == '${action.label}'\"\n                steps:\n                  - to:\n                      uri: kamelet:${action.actionId}\n`).join('')}              - simple: \"\${exchangeProperty.department} == 'no_match'\"\n                steps:\n                  - setBody:\n                      constant: No matching action.\n`;
    const files: Record<string, string> = {
      'index.properties': 'catalog.name=semantic-preview\ncatalog.services=service\ncatalog.routes.service=service/router.camel.yaml\n',
      'service/router.camel.yaml': `${question}${classify}${dispatch}- route:\n    id: router-mcp-entry\n    from:\n      uri: ai-tool:${definition.toolName}\n      steps:\n        - to: direct:dispatch-router\n`,
      'service/preview.camel.yaml': question + classify,
      'service/semantic-router.properties': `contract.version=1\ncatalog.revision=preview\ncamel.version=4.23.0-SNAPSHOT\nmain=service/router.camel.yaml\npreview.main=service/preview.camel.yaml\nexpert.bean=${selectedExpert.bean}\ntool.name=${definition.toolName}\n`,
      'service/service.properties': (definition.actions ?? []).map(action => `action.${action.label}.prefix=${action.configuration?.prefix ?? 'Support'}\n${action.configuration?.credentialRef ? `action.${action.label}.credentialRef={{env:${action.configuration.credentialRef.slice(4)}}}\n` : ''}`).join(''),
      'service/dependencies.txt': `camel:ai-tool\ncamel:core\ncamel:direct\ncamel:kamelet\ncamel:semantic\n${[...new Set([selectedExpert.dependency, guardExpert?.dependency].filter(Boolean))].map(dependency => `mvn:${dependency}\n`).join('')}`,
      'service/experts.json': JSON.stringify({ classifier: selectedExpert, guard: publishedGuard(definition.guard, experts) }),
    };
    for (const action of definition.actions ?? []) {
      files[`service/kamelets/${action.actionId}.kamelet.yaml`] = `apiVersion: camel.apache.org/v1\nkind: Kamelet\nmetadata:\n  name: ${action.actionId}\nspec:\n  template:\n    from:\n      uri: kamelet:source\n      steps:\n        - setBody:\n            constant: \"{{prefix}}\"\n`;
    }
    return files;
  };
  await page.route('**/api/v1/semantic-routers**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/semantic-routers', '');
    const parts = path.split('/').filter(Boolean);
    const json = async (data: unknown) => route.fulfill({ json: { data } });
    if (path === '/actions') {
      const definitionId = new URL(request.url()).searchParams.get('definitionId') ?? undefined;
      actionRequests.push(definitionId);
      return json(catalog ? catalog(actions, definitionId) : actions);
    }
    if (parts[0] === 'experts') return expertRequest(route, experts, definitions, expertRequests);
    if (path === '/resolve') {
      const name = new URL(request.url()).searchParams.get('name') ?? '';
      resolutions.push(name);
      const draft = [...definitions.values()].find(definition => definition.name === name);
      const status = draft?.id ? resolutionErrors.get(draft.id) : 404;
      if (status) return route.fulfill({ status, json: { error: { message: status === 409
        ? 'Several legacy publications exist. Select an explicit revision.' : 'No current publication is available.' } } });
      const records = publications.get(draft!.id!) ?? [];
      const revision = new URL(request.url()).searchParams.get('revision') ?? currentPublications.get(draft!.id!);
      const selected = records.find(publication => publication.revision === revision);
      if (!selected) return route.fulfill({ status: 404, json: { error: { message: 'No current publication is available.' } } });
      return json({ ...selected, name, service: 'service', expert: selected.expert ?? null });
    }
    if (path === '/validate') {
      const errors = validate(request.postDataJSON() as SemanticRouterDefinition, false);
      return json({ valid: errors.length === 0, errors });
    }
    if (path === '/files') {
      const definition = request.postDataJSON() as SemanticRouterDefinition;
      fileRequests.push(definition);
      const status = fileStatuses.shift() ?? 200;
      if (status !== 200) return route.fulfill({ status, json: { error: { message: 'Generated files are temporarily unavailable' } } });
      const errors = validate(definition, false);
      if (errors.length) return route.fulfill({ status: errors.some(error => error.field === 'name' || error.field === 'toolName') ? 400 : 422, json: { error: { message: errors.map(error => `${error.field}: ${error.message}`).join('; ') } } });
      return json(generatedFiles(definition));
    }
    if (!parts.length) {
      if (request.method() === 'GET') return json([...definitions.values()]);
      const draft = { ...request.postDataJSON(), id: `draft-${definitions.size + 1}` } as SemanticRouterDefinition;
      const errors = validate(draft, true);
      if (errors.length) return route.fulfill({ status: 400, json: { error: { message: errors.map(error => `${error.field}: ${error.message}`).join('; ') } } });
      saves.push(draft);
      definitions.set(draft.id!, draft);
      return json(draft);
    }
    const id = parts[0];
    if (parts[1] === 'revisions') return json([...(publications.get(id) ?? [])].sort((first, second) => (first.revision ?? '').localeCompare(second.revision ?? '')));
    if (parts[1] === 'preview') {
      const { message } = request.postDataJSON() as { message: string };
      previews.push(message);
      return json(previewResult(message, definitions.get(id)?.guard));
    }
    if (parts[1] === 'publish') {
      const errors = validate(definitions.get(id) ?? {}, false);
      if (errors.length) return route.fulfill({ status: 422, json: { error: { message: errors.map(error => `${error.field}: ${error.message}`).join('; ') } } });
      publishRequests.push(id);
      const publication: SemanticPublication = {
        definitionId: id, toolName: definitions.get(id)?.toolName, expert: experts.get(definitions.get(id)?.expertId ?? ""), revision: 'revision-001', catalogName: 'fixture-catalog', sha256: 'a'.repeat(64),
        mainFile: 'service/router.camel.yaml', camelVersion: '4.23.0-SNAPSHOT', camelBuild: 'fixture-tested-build',
        guard: publishedGuard(definitions.get(id)?.guard, experts),
        downloadUrl: '/api/v1/service-catalog/download?name=fixture-catalog', status: 'published',
        deploymentInstructions: ['Set WSR_CATALOG_REVISION=revision-001. Start WSR with the published catalog.'],
      };
      publications.set(id, [publication]);
      currentPublications.set(id, publication.revision!);
      return json(publication);
    }
    if (request.method() === 'DELETE') { definitions.delete(id); return json(null); }
    if (request.method() === 'PUT') {
      const draft = { ...request.postDataJSON(), id } as SemanticRouterDefinition;
      const errors = validate(draft, true);
      if (errors.length) return route.fulfill({ status: 400, json: { error: { message: errors.map(error => `${error.field}: ${error.message}`).join('; ') } } });
      saves.push(draft);
      definitions.set(id, draft);
      return json(draft);
    }
    return json(definitions.get(id));
  });
  return { experts, expertRequests, definitions, previews, publications, currentPublications, resolutionErrors, resolutions, actionRequests, fileRequests, fileStatuses, saves, publishRequests };
}
