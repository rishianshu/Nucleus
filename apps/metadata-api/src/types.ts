export type EndpointFieldOption = {
  label: string;
  value: string;
  description?: string | null;
};

export type EndpointFieldVisibilityRule = {
  field: string;
  values: string[];
};

export type EndpointFieldDescriptor = {
  key: string;
  label: string;
  valueType: string;
  required: boolean;
  semantic?: string | null;
  description?: string | null;
  placeholder?: string | null;
  helpText?: string | null;
  options?: EndpointFieldOption[];
  regex?: string | null;
  min?: number | null;
  max?: number | null;
  defaultValue?: string | null;
  advanced?: boolean | null;
  sensitive?: boolean | null;
  dependsOn?: string | null;
  dependsValue?: string | null;
  visibleWhen?: EndpointFieldVisibilityRule[] | null;
};

export type EndpointCapability = {
  key: string;
  label: string;
  description?: string | null;
};

export type EndpointProbingMethod = {
  key: string;
  label: string;
  strategy: string;
  statement?: string | null;
  description?: string | null;
  requires?: string[];
  returnsVersion?: boolean | null;
  returnsCapabilities?: string[];
};

export type EndpointProbingPlan = {
  methods: EndpointProbingMethod[];
  fallbackMessage?: string | null;
};

export type EndpointTemplate = {
  id: string;
  family: "JDBC" | "HTTP" | "STREAM";
  title: string;
  vendor: string;
  description?: string | null;
  domain?: string | null;
  categories: string[];
  protocols: string[];
  versions: string[];
  defaultPort?: number | null;
  driver?: string | null;
  docsUrl?: string | null;
  agentPrompt?: string | null;
  defaultLabels?: string[];
  fields: EndpointFieldDescriptor[];
  capabilities: EndpointCapability[];
  sampleConfig?: Record<string, unknown> | null;
  connection?: {
    urlTemplate?: string | null;
    defaultVerb?: string | null;
  } | null;
  descriptorVersion?: string | null;
  minVersion?: string | null;
  maxVersion?: string | null;
  probing?: EndpointProbingPlan | null;
};

export type EndpointBuildResult = {
  url: string;
  config: Record<string, unknown>;
  labels?: string[];
  domain?: string | null;
  verb?: string | null;
};

export type EndpointTestResult = {
  success: boolean;
  message?: string | null;
  detectedVersion?: string | null;
  capabilities?: string[];
  details?: Record<string, unknown> | null;
};
