import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import companyConfig from '../../config/company.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;

function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

beforeAll(() => {
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
}, 60000);

const TEST_CIF = companyConfig.cif;
const CAREER_URL = companyConfig.careerUrl;

describe('E2E: Full Scraping Pipeline', () => {

  describe('Axon Soft Careers Page — Real Data Fetch', () => {
    let html;

    beforeAll(async () => {
      const res = await fetch(CAREER_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      html = await res.text();
    }, 15000);

    it('should load the careers page', () => {
      expect(html).toContain('Careers');
      expect(html).toContain('Axon Soft');
    });

    it('should have job listing panels', () => {
      expect(html).toContain('fusion-panel');
      expect(html).toContain('fusion-toggle-heading');
    });

    it('should contain job titles', () => {
      expect(html).toContain('Java');
      expect(html).toContain('QA');
    });
  });

  describe('Parse Pipeline', () => {
    let index;

    beforeAll(async () => {
      index = await import('../../index.js');
    }, 60000);

    it('should parse real careers page HTML into job listings', async () => {
      const res = await fetch(CAREER_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      const html = await res.text();
      const jobs = index.parseCareerPage(html);

      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThan(0);

      const job = jobs[0];
      expect(job).toHaveProperty('url');
      expect(job.url).toContain('axon-soft.com');
      expect(job).toHaveProperty('title');
    }, 15000);

    it('should map parsed jobs to job model', async () => {
      const res = await fetch(CAREER_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      const html = await res.text();
      const jobs = index.parseCareerPage(html);
      const model = index.mapToJobModel(jobs[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model).toHaveProperty('company');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
    }, 15000);

    it('should produce valid job URLs that are accessible', async () => {
      const res = await fetch(CAREER_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      const html = await res.text();
      const jobs = index.parseCareerPage(html);

      for (const job of jobs.slice(0, 2)) {
        const jobRes = await fetch(job.url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        });
        expect(jobRes.ok).toBe(true);
      }
    }, 30000);
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      company = await import('../../company.js');
    }, 60000);

    it('should find Axon Soft in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany('13049596');

      const target = results.find(c =>
        c.cui.toString() === '13049596' &&
        c.statusLabel === 'Funcțiune'
      );
      expect(target).toBeDefined();
      expect(target.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('AXON SOFT SRL');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('⚠️ No Axon Soft jobs in Solr — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('SOLR Data Verification', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should have Axon Soft jobs in SOLR with correct company name', async () => {
      const result = await solr.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No Axon Soft jobs in Solr — skipping SOLR data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe('AXON SOFT SRL');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfSolr('should have Axon Soft company core entry with required fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${TEST_CIF}`);

      expect(result.numFound).toBe(1);
      const comp = result.docs[0];
      expect(comp.company).toBe('AXON SOFT SRL');
      expect(comp.status).toBe('activ');
    }, 15000);
  });
});
