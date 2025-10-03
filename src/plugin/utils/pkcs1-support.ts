/**
 * Utility functions to detect Node.js PKCS1 support
 */

/**
 * Check if the current Node.js version supports PKCS1 padding natively
 * Node.js versions that removed PKCS1 support: 18.19.1+, 20.11.1+, 21.6.2+
 * Node.js versions that restored PKCS1 support: 24.9.0+ (with OpenSSL 3.5.2+)
 */
export function hasNativePKCS1Support(): boolean {
  const nodeVersion = process.version;
  const openSSLVersion = process.versions.openssl;
  
  // Parse Node.js version
  const nodeVersionMatch = nodeVersion.match(/^v(\d+)\.(\d+)\.(\d+)/);
  if (!nodeVersionMatch) {
    return false;
  }
  
  const nodeMajor = parseInt(nodeVersionMatch[1], 10);
  const nodeMinor = parseInt(nodeVersionMatch[2], 10);
  const nodePatch = parseInt(nodeVersionMatch[3], 10);
  
  // Handle missing OpenSSL version (should not happen in normal Node.js, but defensive programming)
  if (!openSSLVersion) {
    return false;
  }
  
  // Parse OpenSSL version
  const opensslVersionMatch = openSSLVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!opensslVersionMatch) {
    return false;
  }
  
  const opensslMajor = parseInt(opensslVersionMatch[1], 10);
  const opensslMinor = parseInt(opensslVersionMatch[2], 10);
  const opensslPatch = parseInt(opensslVersionMatch[3], 10);
  
  // Node.js 24.9.0+ with OpenSSL 3.5.2+ has restored PKCS1 support
  if (nodeMajor >= 25) {
    return true;
  }
  
  if (nodeMajor === 24 && nodeMinor >= 9) {
    // Check if OpenSSL is 3.5.2+
    if (opensslMajor > 3) {
      return true;
    }
    if (opensslMajor === 3 && opensslMinor > 5) {
      return true;
    }
    if (opensslMajor === 3 && opensslMinor === 5 && opensslPatch >= 2) {
      return true;
    }
  }
  
  // Versions before the PKCS1 removal had native support
  if (nodeMajor < 18) {
    return true;
  }
  
  if (nodeMajor === 18 && nodeMinor < 19) {
    return true;
  }
  
  if (nodeMajor === 18 && nodeMinor === 19 && nodePatch < 1) {
    return true;
  }
  
  if (nodeMajor === 20 && nodeMinor < 11) {
    return true;
  }
  
  if (nodeMajor === 20 && nodeMinor === 11 && nodePatch < 1) {
    return true;
  }
  
  if (nodeMajor === 21 && nodeMinor < 6) {
    return true;
  }
  
  if (nodeMajor === 21 && nodeMinor === 6 && nodePatch < 2) {
    return true;
  }
  
  // For versions that removed PKCS1 support but haven't restored it
  return false;
}

/**
 * Get the list of problematic Node.js versions that removed PKCS1 support
 */
export function getProblematicNodeVersions(): string[] {
  return ['18.19.1+', '20.11.1+', '21.6.2+', '22.x.x', '23.x.x'];
}

/**
 * Check if embedded PKCS1 support should be automatically enabled
 * based on the current Node.js and OpenSSL versions
 */
export function shouldEnableEmbeddedPKCS1(manualOverride?: boolean): boolean {
  // If user has manually set the override, respect it
  if (manualOverride !== undefined) {
    return manualOverride;
  }
  
  // If native PKCS1 support is available, don't use embedded support
  return !hasNativePKCS1Support();
}