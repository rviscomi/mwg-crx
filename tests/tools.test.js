import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Mock all the functions called in tools.js execute handlers
global.listUseCases = vi.fn();
global.listCategories = vi.fn();
global.searchUseCases = vi.fn();
global.getGuideContent = vi.fn();
global.getPageDOM = vi.fn();
global.getAccessibilityTree = vi.fn();
global.executeJS = vi.fn();
global.getInspectedElement = vi.fn();
global.getElementInfo = vi.fn();
global.inspectEventListeners = vi.fn();
global.analyzeLayoutMetrics = vi.fn();
global.getLcpElement = vi.fn();
global.getViewportImages = vi.fn();
global.getNetworkRequests = vi.fn();
global.getDocumentHeaders = vi.fn();
global.simulateAndMeasureInp = vi.fn();
global.analyzeCssCoverage = vi.fn();
global.analyzeJsDependencies = vi.fn();
global.checkBfcacheReasons = vi.fn();
global.simulateAction = vi.fn();
global.getConsoleLogs = vi.fn();
global.applyPreview = vi.fn();
global.saveOverride = vi.fn();
global.takeScreenshot = vi.fn();

// Define a global config mock
global.config = {
  capInteraction: true,
  capLogs: true,
  capPreview: true,
  capOverride: true,
  capScreenshot: true,
  capScripting: true,
  capNetwork: true
};

// Require tools.js
const { getEnabledTools, executeTool } = require('../tools.js');

describe('tools.js - Capability Configuration and Execution Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all capabilities to true by default
    global.config = {
      capInteraction: true,
      capLogs: true,
      capPreview: true,
      capOverride: true,
      capScreenshot: true,
      capScripting: true,
      capNetwork: true
    };
  });

  it('should enable all tools when all capabilities are true', () => {
    const enabled = getEnabledTools();
    const declarations = enabled[0].functionDeclarations;
    const names = declarations.map(d => d.name);

    expect(names).toContain('execute_js');
    expect(names).toContain('get_network_requests');
    expect(names).toContain('get_document_headers');
    expect(names).toContain('simulate_and_measure_inp');
    expect(names).toContain('simulate_action');
    expect(names).toContain('get_console_logs');
    expect(names).toContain('apply_preview');
    expect(names).toContain('save_override');
    expect(names).toContain('take_screenshot');
  });

  it('should disable execute_js when scripting capability is false', async () => {
    global.config.capScripting = false;
    
    const enabled = getEnabledTools();
    const declarations = enabled[0].functionDeclarations;
    const names = declarations.map(d => d.name);

    expect(names).not.toContain('execute_js');

    // Trying to execute the tool should fail with disabled error
    await expect(executeTool('execute_js', { code: '1+1', purpose: 'test' }))
      .rejects.toThrow('Tool "execute_js" is disabled by user capability configurations.');
  });

  it('should disable network tools when network capability is false', async () => {
    global.config.capNetwork = false;
    
    const enabled = getEnabledTools();
    const declarations = enabled[0].functionDeclarations;
    const names = declarations.map(d => d.name);

    expect(names).not.toContain('get_network_requests');
    expect(names).not.toContain('get_document_headers');

    await expect(executeTool('get_network_requests', {}))
      .rejects.toThrow('Tool "get_network_requests" is disabled by user capability configurations.');

    await expect(executeTool('get_document_headers', {}))
      .rejects.toThrow('Tool "get_document_headers" is disabled by user capability configurations.');
  });

  it('should disable interaction tools when interaction capability is false', async () => {
    global.config.capInteraction = false;
    
    const enabled = getEnabledTools();
    const declarations = enabled[0].functionDeclarations;
    const names = declarations.map(d => d.name);

    expect(names).not.toContain('simulate_action');
    expect(names).not.toContain('simulate_and_measure_inp');

    await expect(executeTool('simulate_action', { selector: 'button', action: 'click' }))
      .rejects.toThrow('Tool "simulate_action" is disabled by user capability configurations.');

    await expect(executeTool('simulate_and_measure_inp', { selector: 'button', action: 'click' }))
      .rejects.toThrow('Tool "simulate_and_measure_inp" is disabled by user capability configurations.');
  });

  it('should execute enabled tools successfully', async () => {
    global.executeJS.mockResolvedValue({ success: true });
    const result = await executeTool('execute_js', { code: '1+1', purpose: 'test' });
    expect(result).toEqual({ success: true });
    expect(global.executeJS).toHaveBeenCalledWith('1+1');
  });
});
