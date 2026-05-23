import { type GitHubRepoRef } from './github.js'
import { type NormalizedRemotePlan } from './init.js'

export type RepoRole = keyof NormalizedRemotePlan
export type RepoAction = 'create' | 'reuse'

export interface RepoPlanItem {
  role: RepoRole
  ref: GitHubRepoRef
  action: RepoAction
  private: boolean
}

export interface RepoPlan {
  main: RepoPlanItem
  backend: RepoPlanItem
  frontend: RepoPlanItem
}
