import { loadDotEnv } from '@imc/db';
import { resetTestDatabase, testDatabaseUrls } from '@imc/testing';

export default async function setup() {
  loadDotEnv();
  await resetTestDatabase(testDatabaseUrls());
}
