/**
 * GPU Detection Utility
 *
 * Detects available GPUs for local code execution.
 * Supports NVIDIA (CUDA) and AMD (ROCm) GPUs.
 */

import { spawn } from "child_process";

export interface GPUInfo {
  available: boolean;
  type: "nvidia" | "amd" | "none";
  devices: GPUDevice[];
  cudaVersion?: string;
  driverVersion?: string;
}

export interface GPUDevice {
  index: number;
  name: string;
  memoryTotal: string;
  memoryFree?: string;
}

let cachedGPUInfo: GPUInfo | null = null;

/**
 * Detect available GPUs on the system
 * Results are cached after first call
 */
export async function detectGPU(): Promise<GPUInfo> {
  if (cachedGPUInfo) {
    return cachedGPUInfo;
  }

  // Try NVIDIA first
  const nvidiaInfo = await detectNvidiaGPU();
  if (nvidiaInfo.available) {
    cachedGPUInfo = nvidiaInfo;
    return nvidiaInfo;
  }

  // Try AMD ROCm
  const amdInfo = await detectAMDGPU();
  if (amdInfo.available) {
    cachedGPUInfo = amdInfo;
    return amdInfo;
  }

  // No GPU found
  cachedGPUInfo = { available: false, type: "none", devices: [] };
  return cachedGPUInfo;
}

/**
 * Detect NVIDIA GPUs using nvidia-smi
 */
async function detectNvidiaGPU(): Promise<GPUInfo> {
  try {
    const output = await runCommand("nvidia-smi", [
      "--query-gpu=index,name,memory.total,memory.free,driver_version",
      "--format=csv,noheader,nounits",
    ]);

    if (!output.trim()) {
      return { available: false, type: "none", devices: [] };
    }

    const devices: GPUDevice[] = [];
    const lines = output.trim().split("\n");

    for (const line of lines) {
      const [index, name, memTotal, memFree] = line.split(", ").map((s) => s.trim());
      if (index && name && memTotal) {
        devices.push({
          index: parseInt(index, 10),
          name,
          memoryTotal: `${memTotal} MiB`,
          memoryFree: memFree ? `${memFree} MiB` : undefined,
        });
      }
    }

    // Get CUDA version
    let cudaVersion: string | undefined;
    try {
      const nvccOutput = await runCommand("nvcc", ["--version"]);
      const match = nvccOutput.match(/release (\d+\.\d+)/);
      if (match) {
        cudaVersion = match[1];
      }
    } catch {
      // nvcc not installed, try nvidia-smi for CUDA version
      try {
        const smiOutput = await runCommand("nvidia-smi", []);
        const match = smiOutput.match(/CUDA Version: (\d+\.\d+)/);
        if (match) {
          cudaVersion = match[1];
        }
      } catch {
        // Ignore
      }
    }

    // Get driver version from first line
    const driverMatch = lines[0]?.split(", ")[4];

    return {
      available: devices.length > 0,
      type: "nvidia",
      devices,
      cudaVersion,
      driverVersion: driverMatch,
    };
  } catch {
    return { available: false, type: "none", devices: [] };
  }
}

/**
 * Detect AMD GPUs using rocm-smi
 */
async function detectAMDGPU(): Promise<GPUInfo> {
  try {
    const output = await runCommand("rocm-smi", ["--showproductname", "--showmeminfo", "vram"]);

    if (!output.trim()) {
      return { available: false, type: "none", devices: [] };
    }

    // Parse rocm-smi output (format varies by version)
    const devices: GPUDevice[] = [];
    const lines = output.split("\n");

    let currentIndex = 0;
    for (const line of lines) {
      if (line.includes("GPU[")) {
        const nameMatch = line.match(/GPU\[(\d+)\].*?: (.+)/);
        if (nameMatch && nameMatch[1] && nameMatch[2]) {
          devices.push({
            index: parseInt(nameMatch[1], 10),
            name: nameMatch[2].trim(),
            memoryTotal: "Unknown",
          });
          currentIndex = parseInt(nameMatch[1], 10);
        }
      }
      const device = devices[currentIndex];
      if (line.includes("Total Memory") && device) {
        const memMatch = line.match(/(\d+)\s*(MB|GB|MiB|GiB)/i);
        if (memMatch && memMatch[1] && memMatch[2]) {
          device.memoryTotal = `${memMatch[1]} ${memMatch[2]}`;
        }
      }
    }

    return {
      available: devices.length > 0,
      type: "amd",
      devices,
    };
  } catch {
    return { available: false, type: "none", devices: [] };
  }
}

/**
 * Run a command and return stdout
 */
function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: 5000 });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Get a summary string for logging/display
 */
export function getGPUSummary(info: GPUInfo): string {
  if (!info.available) {
    return "No GPU detected";
  }

  const gpuList = info.devices.map((d) => `${d.name} (${d.memoryTotal})`).join(", ");
  let summary = `${info.type.toUpperCase()} GPU: ${gpuList}`;

  if (info.cudaVersion) {
    summary += ` | CUDA ${info.cudaVersion}`;
  }

  return summary;
}

/**
 * Clear cached GPU info (useful for testing or after hardware changes)
 */
export function clearGPUCache(): void {
  cachedGPUInfo = null;
}
