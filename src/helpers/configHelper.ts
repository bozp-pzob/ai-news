import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ConfigItem, InstanceConfig } from "../types";

dotenv.config();

export const loadDirectoryModules = async (directory : string): Promise<Record<string, any>> => {
  const classes: Record<string, any> = {};
  const dir = path.join(__dirname, "../", "plugins", directory);
  
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".ts"));
  
  for (const file of files) {
    const modulePath = path.join(dir, file);
    const moduleExports = await import(modulePath);
    const className = file.replace(".ts", "");

    classes[className] = moduleExports.default || moduleExports[className];
  }
  
  return classes;
};

export const loadItems = async (items: ConfigItem[], mapping: Record<string, any>, category: string): Promise<InstanceConfig[]> => {
  return items.map((item) => {
    const { type, name, params, interval } = item;
    const ClassRef = mapping[type];
    if (!ClassRef) {
      throw new Error(`Unknown ${category} type: ${type}`);
    }
    const resolvedParams = Object.entries(params).reduce((acc, [key, value]) => {
      acc[key] = typeof value === "string" ? resolveParam(value) : value;
      return acc;
    }, {} as Record<string, any>);

    const instance = new ClassRef({ name, ...resolvedParams });
    
    return interval !== undefined ? { instance, interval } : { instance };
  });
}

export const loadProviders = async (instances: InstanceConfig[], providers: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("provider" in instance && instance.provider) {
      const chosenProvider = providers.find((provider : any) => {
        return provider.instance.name === instance.provider
      });

      if ( ! chosenProvider ) {
        throw(`Error: Invalid Provider Name ${instance.provider}`);
      }
      else {
        instance.provider = chosenProvider.instance;
      }
    }
  });

  return instances;
}

export const loadParsers = async (instances: InstanceConfig[], parsers: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("parser" in instance && instance.parser) {
      const chosenParser = parsers.find((parser : any) => {
        return parser.instance.name === instance.parser
      });

      if ( ! chosenParser ) {
        throw(`Error: Invalid Parser Name ${instance.parser}`);
      }
      else {
        instance.parser = chosenParser.instance;
      }
    }
  });

  return instances;
}

export const loadStorage = async (instances: InstanceConfig[], storages: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("storage" in instance && instance.storage) {
      const chosenStorage = storages.find((storage : any) => {
        return storage.instance.name === instance.storage
      });

      if ( ! chosenStorage ) {
        throw(`Error: Invalid Storage Name ${instance.storage}`);
      }
      else {
        instance.storage = chosenStorage.instance;
      }
    }
  });

  return instances;
}

export const resolveParam = (value: String): any => {
  if (value.startsWith("process.env.")) {
    const envVar = value.replace("process.env.", "");
    return process.env[envVar] || "";
  }
  return value;
};