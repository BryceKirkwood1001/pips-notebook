// Restore the packs listed in the shared manifest using the installed Phaser AE CLI.
import { needProject } from './phaser/cli/lib/config.mjs';
import { siteClient, apiAccess } from './phaser/cli/lib/site.mjs';
import { installManifest } from './phaser/cli/lib/packs.mjs';
import { fetchUiFonts } from './phaser/cli/lib/engine.mjs';

const project = needProject();
const access = await apiAccess(siteClient({ project }));
await installManifest(access, project.dir);
await fetchUiFonts(project.dir);
