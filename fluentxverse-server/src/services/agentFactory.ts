import { Agent } from "@mastra/core/agent";

type AgentConstructorConfig = ConstructorParameters<typeof Agent>[0];
type AgentConfigWithOptionalId = Omit<AgentConstructorConfig, "id"> & {
  id?: AgentConstructorConfig["id"];
};

const toAgentId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const createAgent = (config: AgentConfigWithOptionalId) =>
  new Agent({
    ...config,
    id: config.id ?? toAgentId(config.name),
  } as AgentConstructorConfig);
