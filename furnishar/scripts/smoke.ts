// Quick sanity check of the offline layout engine + verifier: `npx tsx scripts/smoke.ts`
import { fallbackDesign } from '../lib/fallbackDesigner';
import { products } from '../lib/products';
import { buildRectangularRoom } from '../lib/room';
import { verifyDesign } from '../lib/verification';

const cases = [
  { dims: [14, 12, 9], type: 'living_room', budget: 2000 },
  { dims: [10, 10, 8], type: 'bedroom', budget: 800 },
  { dims: [20, 16, 9], type: 'studio', budget: 5000 },
];
const priorities = {
  mustHave: ['sofa', 'desk'],
  niceToHave: ['bookshelf', 'rug'],
  stretch: ['lamp', 'coffee_table', 'chair'],
};
for (const c of cases) {
  const room = buildRectangularRoom(
    { width: c.dims[0] * 0.3048, length: c.dims[1] * 0.3048, height: c.dims[2] * 0.3048 },
    c.type,
  );
  const plan = fallbackDesign({ roomLayout: room, style: 'Cozy Scandinavian', budget: c.budget, priorities, catalog: products });
  const v = verifyDesign(room, plan, products);
  console.log(`${c.dims.join('x')}ft $${c.budget}: ${v.status}, ${plan.placements.length} pieces, $${plan.budget_summary.total}`);
  for (const p of plan.placements) console.log(`   ${p.product_name.padEnd(10)} ${p.category.padEnd(13)} (${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}) rot ${p.rotation}`);
  for (const x of v.violations) console.log('   !', x.type, x.description);
}
