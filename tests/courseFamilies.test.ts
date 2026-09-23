import { describe, it, expect } from 'vitest';
import { COURSE_FAMILIES, familyById, familyForCourse } from '../src/widget/courseFamilies';

// The approved scheme (Jenni, 17 Sep 2026, with her amendments). Every live
// template slug must land in its agreed family — this is the contract the
// colour coding and filters ship against.
const APPROVED: Record<string, string> = {
  // Pink
  'baby-child-first-aid': 'baby-family',
  'baby-child-2hr': 'baby-family',
  'family-first-aid': 'baby-family',
  'baby-first-aid-essentials': 'baby-family',
  // Blue (incl. Anaphylaxis per amendment)
  'level-3-emergency-paediatric-first-aid': 'paediatric',
  'level-3-blended-paediatric-first-aid': 'paediatric',
  'level-6-emergency-paediatric-first-aid': 'paediatric',
  'level-6-blended-paediatric-first-aid': 'paediatric',
  'emergency-paediatric': 'paediatric',
  'paediatric-aow': 'paediatric',
  'blended-learning': 'paediatric',
  'anaphylaxis-awareness': 'paediatric',
  // Coral (incl. Duty of Care + Basic Life Saver per amendment)
  'emergency-first-aid-at-work': 'workplace',
  'first-aid-at-work': 'workplace',
  'baby-child-first-aid-duty-of-care': 'workplace',
  'baby-child-full-day': 'workplace',
  'basic-life-saver': 'workplace',
  // Green
  'first-aid-for-children': 'teaching-children',
  // Yellow
  'online-class': 'online',
  'baby-essentials': 'online',
  // Violet
  'bespoke-first-aid': 'bespoke-other',
  'corporate-bespoke': 'bespoke-other',
};

describe('courseFamilies', () => {
  it('maps every live template slug to its approved family', () => {
    for (const [slug, family] of Object.entries(APPROVED)) {
      expect(familyForCourse({ template_slug: slug }), slug).toBe(family);
    }
  });

  it('has six families, each with a colour and label', () => {
    expect(COURSE_FAMILIES).toHaveLength(6);
    for (const f of COURSE_FAMILIES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.colour).toMatch(/^#[0-9A-F]{6}$/i);
      expect(familyById(f.id)).toBe(f);
    }
  });

  it('falls back on template name for unknown slugs', () => {
    expect(familyForCourse({ template_slug: 'new-thing', template_name: 'Online Toddler Class' })).toBe('online');
    expect(familyForCourse({ template_slug: 'x', template_name: 'First Aid At Work Refresher' })).toBe('workplace');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Duty of Care Refresher' })).toBe('workplace');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Level 3 Paediatric Refresher' })).toBe('paediatric');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Anaphylaxis Update' })).toBe('paediatric');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Teaching First Aid to Children' })).toBe('teaching-children');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Baby Weaning First Aid' })).toBe('baby-family');
    expect(familyForCourse({ template_slug: 'x', template_name: 'Corporate Bespoke Day' })).toBe('bespoke-other');
  });

  it('routes wholly unknown courses to bespoke-other', () => {
    expect(familyForCourse({ template_slug: 'mystery', template_name: 'Mystery Session' })).toBe('bespoke-other');
    expect(familyForCourse({})).toBe('bespoke-other');
  });
});
