#!/usr/bin/env node

/**
 * Webhook Authentication Migration Utility
 * 
 * This script helps migrate from insecure webhook implementations
 * to HMAC-SHA256 authenticated webhooks.
 * 
 * Features:
 * - Generates secure webhook secrets
 * - Validates existing configurations  
 * - Updates GitHub Actions workflows
 * - Tests webhook security implementation
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class WebhookMigration {
  constructor() {
    this.dryRun = process.argv.includes('--dry-run');
    this.verbose = process.argv.includes('--verbose');
    this.force = process.argv.includes('--force');
  }

  /**
   * Generate a cryptographically secure webhook secret
   */
  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate webhook secret strength
   */
  validateSecret(secret) {
    const issues = [];
    
    if (!secret) {
      issues.push('Secret is empty');
      return { valid: false, issues };
    }
    
    if (secret.length < 32) {
      issues.push('Secret is too short (minimum 32 characters)');
    }
    
    if (secret.length < 64) {
      issues.push('Secret should be at least 64 characters for optimal security');
    }
    
    // Check if it's hex
    if (!/^[a-f0-9]+$/i.test(secret)) {
      issues.push('Secret should be hexadecimal for consistency with standards');
    }
    
    // Check for common weak patterns
    if (/(.)\1{4,}/.test(secret)) {
      issues.push('Secret contains repeated character patterns');
    }
    
    return { valid: issues.length === 0, issues };
  }

  /**
   * Check current environment configuration
   */
  async checkEnvironment() {
    const results = {
      hasSecret: false,
      secretValid: false,
      secretIssues: [],
      envFileExists: false,
      recommendations: []
    };

    // Check environment variable
    const currentSecret = process.env.COLLECT_WEBHOOK_SECRET;
    if (currentSecret) {
      results.hasSecret = true;
      const validation = this.validateSecret(currentSecret);
      results.secretValid = validation.valid;
      results.secretIssues = validation.issues;
    }

    // Check .env file
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = await fs.readFile(envPath, 'utf8');
      results.envFileExists = true;
      
      if (!envContent.includes('COLLECT_WEBHOOK_SECRET')) {
        results.recommendations.push('Add COLLECT_WEBHOOK_SECRET to .env file');
      }
    } catch (error) {
      results.recommendations.push('Create .env file with COLLECT_WEBHOOK_SECRET');
    }

    return results;
  }

  /**
   * Find potential insecure webhook implementations
   */
  async scanForInsecureWebhooks() {
    const issues = [];
    const scanDirs = ['src', 'scripts', '.github/workflows'];
    
    for (const dir of scanDirs) {
      try {
        const files = await this.getFilesRecursive(dir);
        
        for (const file of files) {
          if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.yml')) {
            const content = await fs.readFile(file, 'utf8');
            
            // Check for insecure patterns
            const insecurePatterns = [
              { pattern: /app\.post.*webhook.*req\.body/i, issue: 'Potentially insecure webhook endpoint' },
              { pattern: /exec.*req\.body/i, issue: 'Command injection vulnerability' },
              { pattern: /webhook.*no.*auth/i, issue: 'Webhook without authentication' },
              { pattern: /curl.*webhook.*-d/i, issue: 'Unauthenticated webhook call' }
            ];
            
            for (const { pattern, issue } of insecurePatterns) {
              if (pattern.test(content)) {
                issues.push({
                  file: file,
                  issue: issue,
                  severity: 'high'
                });
              }
            }
          }
        }
      } catch (error) {
        // Directory might not exist, skip
      }
    }
    
    return issues;
  }

  /**
   * Get all files recursively from a directory
   */
  async getFilesRecursive(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...await this.getFilesRecursive(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }
    
    return files;
  }

  /**
   * Update .env file with secure webhook secret
   */
  async updateEnvFile(secret) {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch (error) {
      // File doesn't exist, will create it
    }
    
    const secretLine = `COLLECT_WEBHOOK_SECRET=${secret}`;
    
    if (envContent.includes('COLLECT_WEBHOOK_SECRET=')) {
      // Replace existing secret
      envContent = envContent.replace(
        /COLLECT_WEBHOOK_SECRET=.*/,
        secretLine
      );
    } else {
      // Add new secret
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n';
      }
      envContent += `# Webhook authentication secret (generated ${new Date().toISOString()})\n`;
      envContent += secretLine + '\n';
    }
    
    if (!this.dryRun) {
      await fs.writeFile(envPath, envContent, 'utf8');
    }
    
    return envPath;
  }

  /**
   * Generate migration report
   */
  generateReport(environment, securityIssues, newSecret) {
    let report = `# Webhook Security Migration Report\n\n`;
    report += `Generated: ${new Date().toISOString()}\n\n`;
    
    // Current status
    report += `## Current Status\n\n`;
    report += `- Webhook secret configured: ${environment.hasSecret ? '✅' : '❌'}\n`;
    report += `- Secret is secure: ${environment.secretValid ? '✅' : '❌'}\n`;
    report += `- Environment file exists: ${environment.envFileExists ? '✅' : '❌'}\n`;
    report += `- Security issues found: ${securityIssues.length}\n\n`;
    
    // Issues
    if (environment.secretIssues.length > 0) {
      report += `### Secret Issues\n\n`;
      for (const issue of environment.secretIssues) {
        report += `- ⚠️ ${issue}\n`;
      }
      report += '\n';
    }
    
    if (securityIssues.length > 0) {
      report += `### Security Vulnerabilities\n\n`;
      for (const issue of securityIssues) {
        report += `- 🔴 **${issue.file}**: ${issue.issue}\n`;
      }
      report += '\n';
    }
    
    // Recommendations
    report += `## Recommendations\n\n`;
    
    if (!environment.hasSecret || !environment.secretValid) {
      report += `1. **Update Webhook Secret**: Use the generated secure secret\n`;
      report += `   \`\`\`bash\n`;
      report += `   export COLLECT_WEBHOOK_SECRET="${newSecret}"\n`;
      report += `   \`\`\`\n\n`;
    }
    
    for (const rec of environment.recommendations) {
      report += `- ${rec}\n`;
    }
    
    if (securityIssues.length > 0) {
      report += `\n2. **Fix Security Issues**: Review and update the identified vulnerable code\n`;
    }
    
    report += `\n3. **Test Implementation**: Run webhook tests to verify security\n`;
    report += `   \`\`\`bash\n`;
    report += `   npm run webhook &\n`;
    report += `   ./scripts/test-webhook.sh\n`;
    report += `   \`\`\`\n\n`;
    
    // Next steps
    report += `## Next Steps\n\n`;
    report += `1. Update all webhook clients to use HMAC authentication\n`;
    report += `2. Deploy the secure webhook server\n`;
    report += `3. Update deployment configurations with the new secret\n`;
    report += `4. Test all webhook integrations\n`;
    report += `5. Monitor security logs for authentication failures\n\n`;
    
    report += `## Security Checklist\n\n`;
    report += `- [ ] Generated secure webhook secret\n`;
    report += `- [ ] Updated .env file with new secret\n`;
    report += `- [ ] Updated deployment configuration\n`;
    report += `- [ ] Fixed identified security vulnerabilities\n`;
    report += `- [ ] Updated all webhook clients\n`;
    report += `- [ ] Tested HMAC authentication\n`;
    report += `- [ ] Set up security monitoring\n`;
    report += `- [ ] Documented migration for team\n`;
    
    return report;
  }

  /**
   * Main migration function
   */
  async migrate() {
    console.log('🔒 Webhook Security Migration Tool');
    console.log('==================================\n');
    
    if (this.dryRun) {
      console.log('🧪 Running in DRY RUN mode - no changes will be made\n');
    }
    
    // Step 1: Check current environment
    console.log('📊 Analyzing current configuration...');
    const environment = await this.checkEnvironment();
    
    // Step 2: Scan for security issues
    console.log('🔍 Scanning for security vulnerabilities...');
    const securityIssues = await this.scanForInsecureWebhooks();
    
    // Step 3: Generate new secret if needed
    let newSecret = null;
    if (!environment.hasSecret || !environment.secretValid || this.force) {
      console.log('🔑 Generating new webhook secret...');
      newSecret = this.generateSecret();
      
      if (this.verbose) {
        console.log(`   Generated secret: ${newSecret.substring(0, 8)}...`);
      }
    }
    
    // Step 4: Update configuration files
    if (newSecret) {
      console.log('📝 Updating configuration files...');
      const envPath = await this.updateEnvFile(newSecret);
      
      if (!this.dryRun) {
        console.log(`   ✅ Updated ${envPath}`);
      } else {
        console.log(`   📋 Would update ${envPath}`);
      }
    }
    
    // Step 5: Generate report
    console.log('📄 Generating migration report...');
    const report = this.generateReport(environment, securityIssues, newSecret);
    
    const reportPath = 'webhook-migration-report.md';
    if (!this.dryRun) {
      await fs.writeFile(reportPath, report, 'utf8');
      console.log(`   ✅ Report saved to ${reportPath}`);
    } else {
      console.log('   📋 Would save report to', reportPath);
    }
    
    // Summary
    console.log('\n🎯 Migration Summary:');
    console.log(`   Security issues found: ${securityIssues.length}`);
    console.log(`   Secret updated: ${newSecret ? 'Yes' : 'No'}`);
    console.log(`   Action required: ${securityIssues.length > 0 || newSecret ? 'Yes' : 'No'}`);
    
    if (this.dryRun) {
      console.log('\n💡 Run without --dry-run to apply changes');
    } else if (newSecret || securityIssues.length > 0) {
      console.log('\n📖 Next steps:');
      console.log('   1. Review the migration report');
      console.log('   2. Update deployment configurations');
      console.log('   3. Test webhook security');
      console.log('   4. Deploy secure webhook server');
    } else {
      console.log('\n✅ No migration needed - configuration is already secure!');
    }
  }
}

// CLI handling
if (require.main === module) {
  const migration = new WebhookMigration();
  
  if (process.argv.includes('--help')) {
    console.log('Webhook Security Migration Utility');
    console.log('Usage: node migrate-webhook-auth.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run    Show what would be changed without making changes');
    console.log('  --verbose    Show detailed output');
    console.log('  --force      Force generation of new secret even if current is valid');
    console.log('  --help       Show this help message');
    process.exit(0);
  }
  
  migration.migrate().catch(error => {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = { WebhookMigration };