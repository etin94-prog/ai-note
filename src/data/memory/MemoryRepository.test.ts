import { repositoryContract } from '../contract/repositoryContract';

import { MemoryRepository } from './MemoryRepository';

repositoryContract('MemoryRepository', () => new MemoryRepository());
