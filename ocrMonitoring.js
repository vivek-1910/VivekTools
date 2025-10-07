/**
 * OCR Server Monitoring
 * Tracks OCR processing requests, errors, and performance
 */

class OCRMonitoring {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalProcessingTime: 0,
      slowestRequest: 0,
      fastestRequest: Infinity,
      fileTypes: {}, // { 'pdf': count, 'image': count }
      errorsByType: {}, // error categories
      dailyStats: {}, // { 'YYYY-MM-DD': { requests, errors, avgTime } }
      recentErrors: [], // Last 50 errors
      totalPagesProcessed: 0,
      avgPagesPerPDF: 0,
    };
  }

  getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  recordRequest({ fileType, processingTime, error, pages = 0, success = true }) {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Track processing time
    if (processingTime) {
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.slowestRequest = Math.max(this.metrics.slowestRequest, processingTime);
      this.metrics.fastestRequest = Math.min(this.metrics.fastestRequest, processingTime);
    }

    // Track file types
    if (fileType) {
      this.metrics.fileTypes[fileType] = (this.metrics.fileTypes[fileType] || 0) + 1;
    }

    // Track pages
    if (pages > 0) {
      this.metrics.totalPagesProcessed += pages;
      const pdfCount = this.metrics.fileTypes['pdf'] || 1;
      this.metrics.avgPagesPerPDF = this.metrics.totalPagesProcessed / pdfCount;
    }

    // Track errors
    if (!success && error) {
      const errorType = error.includes('timeout') ? 'timeout' 
        : error.includes('memory') ? 'memory'
        : error.includes('file type') ? 'invalid_file'
        : 'processing_error';
      
      this.metrics.errorsByType[errorType] = (this.metrics.errorsByType[errorType] || 0) + 1;
      
      this.metrics.recentErrors.unshift({
        timestamp: Date.now(),
        error,
        fileType,
      });
      
      if (this.metrics.recentErrors.length > 50) {
        this.metrics.recentErrors.pop();
      }
    }

    // Track daily stats
    const today = this.getTodayKey();
    if (!this.metrics.dailyStats[today]) {
      this.metrics.dailyStats[today] = {
        requests: 0,
        errors: 0,
        totalTime: 0,
      };
    }
    
    const dailyStats = this.metrics.dailyStats[today];
    dailyStats.requests++;
    if (!success) dailyStats.errors++;
    if (processingTime) dailyStats.totalTime += processingTime;

    // Clean up old stats
    this.cleanupOldStats();
  }

  cleanupOldStats() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const cutoffDate = new Date(thirtyDaysAgo);
    const cutoffKey = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

    for (const key in this.metrics.dailyStats) {
      if (key < cutoffKey) {
        delete this.metrics.dailyStats[key];
      }
    }
  }

  getStatus() {
    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptime / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);

    const avgProcessingTime = this.metrics.totalRequests > 0
      ? Math.round(this.metrics.totalProcessingTime / this.metrics.totalRequests)
      : 0;

    const today = this.getTodayKey();
    const todayStats = this.metrics.dailyStats[today] || { requests: 0, errors: 0, totalTime: 0 };
    const todayErrorRate = todayStats.requests > 0
      ? ((todayStats.errors / todayStats.requests) * 100).toFixed(2)
      : '0.00';
    const todayAvgTime = todayStats.requests > 0
      ? Math.round(todayStats.totalTime / todayStats.requests)
      : 0;

    return {
      uptime: {
        ms: uptime,
        seconds: uptimeSeconds,
        formatted: `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`,
      },
      requests: {
        total: this.metrics.totalRequests,
        successful: this.metrics.successfulRequests,
        failed: this.metrics.failedRequests,
        successRate: this.metrics.totalRequests > 0
          ? ((this.metrics.successfulRequests / this.metrics.totalRequests) * 100).toFixed(2)
          : '100.00',
      },
      performance: {
        avgProcessingTime,
        fastestRequest: this.metrics.fastestRequest === Infinity ? 0 : this.metrics.fastestRequest,
        slowestRequest: this.metrics.slowestRequest,
      },
      today: {
        date: today,
        requests: todayStats.requests,
        errors: todayStats.errors,
        successful: todayStats.requests - todayStats.errors,
        errorRate: todayErrorRate,
        avgProcessingTime: todayAvgTime,
      },
      fileTypes: this.metrics.fileTypes,
      errorsByType: this.metrics.errorsByType,
      recentErrors: this.metrics.recentErrors.slice(0, 10),
      ocr: {
        totalPagesProcessed: this.metrics.totalPagesProcessed,
        avgPagesPerPDF: Math.round(this.metrics.avgPagesPerPDF * 10) / 10,
      },
    };
  }

  getHealth() {
    const errorRate = this.metrics.totalRequests > 0
      ? (this.metrics.failedRequests / this.metrics.totalRequests) * 100
      : 0;

    let status = 'healthy';
    if (errorRate > 50) status = 'critical';
    else if (errorRate > 20) status = 'degraded';
    else if (errorRate > 5) status = 'warning';

    return {
      status,
      uptime: Date.now() - this.startTime,
      errorRate: errorRate.toFixed(2),
      timestamp: Date.now(),
    };
  }
}

module.exports = new OCRMonitoring();
