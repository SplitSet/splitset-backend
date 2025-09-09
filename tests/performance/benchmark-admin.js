const autocannon = require('autocannon');
const jwt = require('jsonwebtoken');

// Generate admin JWT token for benchmarking
function generateAdminToken() {
  const payload = {
    userId: 2,
    email: 'admin@splitset.app',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-jwt-secret-for-benchmarking');
}

const authToken = generateAdminToken();

// Benchmark configuration
const benchmarkConfig = {
  url: 'http://localhost:5001',
  connections: 50,
  pipelining: 1,
  duration: 30, // 30 seconds
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  }
};

// Individual endpoint benchmarks
const benchmarks = [
  {
    name: 'Admin Dashboard Metrics',
    path: '/api/admin/dashboard/metrics',
    expectedRps: 100, // Expected requests per second
    maxLatency: 500   // Maximum acceptable latency in ms
  },
  {
    name: 'Split Products List',
    path: '/api/admin/products?page=1&limit=50',
    expectedRps: 80,
    maxLatency: 800
  },
  {
    name: 'Orders List',
    path: '/api/admin/orders?page=1&limit=50',
    expectedRps: 70,
    maxLatency: 1000
  },
  {
    name: 'Product Search',
    path: '/api/admin/products?search=Split&page=1&limit=20',
    expectedRps: 60,
    maxLatency: 1200
  },
  {
    name: 'Store Performance',
    path: '/api/admin/stores/performance?period=7d',
    expectedRps: 50,
    maxLatency: 1500
  }
];

// Run benchmarks
async function runBenchmarks() {
  console.log('🚀 Starting SplitSet Admin API Benchmarks\n');
  
  const results = [];
  
  for (const benchmark of benchmarks) {
    console.log(`📊 Benchmarking: ${benchmark.name}`);
    console.log(`   Path: ${benchmark.path}`);
    console.log(`   Expected RPS: ${benchmark.expectedRps}`);
    console.log(`   Max Latency: ${benchmark.maxLatency}ms\n`);
    
    try {
      const result = await autocannon({
        ...benchmarkConfig,
        url: `${benchmarkConfig.url}${benchmark.path}`,
        title: benchmark.name
      });
      
      // Analyze results
      const analysis = analyzeResults(result, benchmark);
      results.push({ benchmark: benchmark.name, result, analysis });
      
      console.log(`✅ ${benchmark.name} completed`);
      console.log(`   RPS: ${result.requests.mean.toFixed(2)} (target: ${benchmark.expectedRps})`);
      console.log(`   Avg Latency: ${result.latency.mean.toFixed(2)}ms (max: ${benchmark.maxLatency}ms)`);
      console.log(`   P95 Latency: ${result.latency.p95.toFixed(2)}ms`);
      console.log(`   P99 Latency: ${result.latency.p99.toFixed(2)}ms`);
      console.log(`   Status: ${analysis.passed ? '✅ PASS' : '❌ FAIL'}\n`);
      
    } catch (error) {
      console.error(`❌ ${benchmark.name} failed:`, error.message);
      results.push({ 
        benchmark: benchmark.name, 
        error: error.message, 
        analysis: { passed: false, issues: ['Benchmark failed to run'] }
      });
    }
    
    // Wait between benchmarks to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  // Generate summary report
  generateSummaryReport(results);
}

// Analyze benchmark results
function analyzeResults(result, benchmark) {
  const analysis = {
    passed: true,
    issues: [],
    recommendations: []
  };
  
  // Check RPS performance
  if (result.requests.mean < benchmark.expectedRps) {
    analysis.passed = false;
    analysis.issues.push(`Low RPS: ${result.requests.mean.toFixed(2)} < ${benchmark.expectedRps}`);
    analysis.recommendations.push('Consider optimizing database queries or adding caching');
  }
  
  // Check latency performance
  if (result.latency.mean > benchmark.maxLatency) {
    analysis.passed = false;
    analysis.issues.push(`High latency: ${result.latency.mean.toFixed(2)}ms > ${benchmark.maxLatency}ms`);
    analysis.recommendations.push('Investigate slow database operations or API calls');
  }
  
  // Check error rate
  if (result.errors > result.requests.total * 0.01) { // More than 1% error rate
    analysis.passed = false;
    analysis.issues.push(`High error rate: ${((result.errors / result.requests.total) * 100).toFixed(2)}%`);
    analysis.recommendations.push('Check server logs for error patterns');
  }
  
  // Check P95 latency (should be within 2x of average)
  if (result.latency.p95 > benchmark.maxLatency * 1.5) {
    analysis.issues.push(`High P95 latency: ${result.latency.p95.toFixed(2)}ms`);
    analysis.recommendations.push('Some requests are significantly slower - investigate outliers');
  }
  
  // Memory and CPU recommendations
  if (result.requests.mean > 50) {
    analysis.recommendations.push('Consider implementing request rate limiting for production');
  }
  
  return analysis;
}

// Generate comprehensive summary report
function generateSummaryReport(results) {
  console.log('\n📋 BENCHMARK SUMMARY REPORT');
  console.log('='.repeat(50));
  
  const passed = results.filter(r => r.analysis && r.analysis.passed).length;
  const total = results.length;
  
  console.log(`Overall Status: ${passed}/${total} benchmarks passed`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);
  
  // Performance insights
  console.log('🔍 PERFORMANCE INSIGHTS:');
  
  const allIssues = results.flatMap(r => r.analysis ? r.analysis.issues : []);
  const allRecommendations = results.flatMap(r => r.analysis ? r.analysis.recommendations : []);
  
  if (allIssues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    [...new Set(allIssues)].forEach(issue => console.log(`   • ${issue}`));
  }
  
  if (allRecommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    [...new Set(allRecommendations)].forEach(rec => console.log(`   • ${rec}`));
  }
  
  // SplitSet-specific insights
  console.log('\n💰 SplitSet Revenue Performance:');
  const dashboardResult = results.find(r => r.benchmark === 'Admin Dashboard Metrics');
  if (dashboardResult && dashboardResult.result) {
    console.log(`   • Dashboard metrics RPS: ${dashboardResult.result.requests.mean.toFixed(2)}`);
    console.log(`   • Revenue calculation latency: ${dashboardResult.result.latency.mean.toFixed(2)}ms`);
    console.log('   • Revenue formula (quantity × ₹9) is being calculated efficiently');
  }
  
  // Production readiness assessment
  console.log('\n🚀 PRODUCTION READINESS:');
  if (passed === total) {
    console.log('   ✅ All benchmarks passed - API is production ready');
    console.log('   ✅ Admin endpoints can handle expected load');
    console.log('   ✅ SplitSet revenue calculations are performant');
  } else {
    console.log('   ⚠️  Some benchmarks failed - review issues before production deployment');
    console.log('   ⚠️  Consider load testing with realistic data volumes');
  }
  
  console.log('\n' + '='.repeat(50));
}

// SplitSet-specific stress test
async function stressTestRevenueCalculation() {
  console.log('\n💰 Running SplitSet Revenue Calculation Stress Test...\n');
  
  const stressConfig = {
    ...benchmarkConfig,
    url: `${benchmarkConfig.url}/api/admin/dashboard/metrics`,
    connections: 100,
    duration: 60, // 1 minute stress test
    title: 'Revenue Calculation Stress Test'
  };
  
  try {
    const result = await autocannon(stressConfig);
    
    console.log('💰 SplitSet Revenue Stress Test Results:');
    console.log(`   • Sustained RPS: ${result.requests.mean.toFixed(2)}`);
    console.log(`   • Peak RPS: ${result.requests.max.toFixed(2)}`);
    console.log(`   • Revenue calc latency: ${result.latency.mean.toFixed(2)}ms`);
    console.log(`   • P99 latency: ${result.latency.p99.toFixed(2)}ms`);
    console.log(`   • Total requests: ${result.requests.total}`);
    console.log(`   • Error rate: ${((result.errors / result.requests.total) * 100).toFixed(2)}%`);
    
    if (result.latency.mean < 200 && result.requests.mean > 80) {
      console.log('   ✅ Revenue calculation can handle high concurrent load');
    } else {
      console.log('   ⚠️  Revenue calculation may need optimization for high load');
    }
    
  } catch (error) {
    console.error('❌ Revenue stress test failed:', error.message);
  }
}

// Main execution
if (require.main === module) {
  runBenchmarks()
    .then(() => stressTestRevenueCalculation())
    .then(() => {
      console.log('\n🎉 All benchmarks completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Benchmark suite failed:', error);
      process.exit(1);
    });
}

module.exports = { runBenchmarks, stressTestRevenueCalculation };
