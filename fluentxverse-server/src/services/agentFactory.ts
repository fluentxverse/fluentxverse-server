import { Agent } from "@mastra/core/agent";
import { noopLogger } from '@mastra/core/logger';
import { privateAgent } from '../privacy/aiBoundary';

type AgentConstructorConfig = ConstructorParameters<typeof Agent>[0];
type AgentConfigWithOptionalId = Omit<AgentConstructorConfig, "id"> & {
  id?: AgentConstructorConfig["id"];
};

const toAgentId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const createAgent = (config: AgentConfigWithOptionalId) => {
  const agent = new Agent({
    ...config,
    id: config.id ?? toAgentId(config.name),
  } as AgentConstructorConfig);
  // SDK failures must not bypass our content-free application logging.
  agent.__setLogger(noopLogger);
  return privateAgent(agent);
};
