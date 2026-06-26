export interface Profile {
  id: string
  display_name: string | null
  created_at: string
}

export interface Quiz {
  id: string
  host_id: string
  title: string
  description: string | null
  break_interval: number
  created_at: string
  updated_at: string
  questions?: Question[]
}

export interface QuestionOption {
  text: string
  isCorrect: boolean
}

export interface Question {
  id: string
  quiz_id: string
  question_text: string
  question_type: 'multiple_choice' | 'true_false'
  options: QuestionOption[]
  time_limit: number
  points: number
  order_index: number
  created_at: string
}

export type GameStatus = 'waiting' | 'playing' | 'question' | 'results' | 'finished'

export interface Game {
  id: string
  quiz_id: string
  host_id: string
  pin: string
  status: GameStatus
  current_question_index: number
  question_start_time: string | null
  created_at: string
  quiz?: Quiz
  players?: Player[]
}

export interface Player {
  id: string
  game_id: string
  nickname: string
  team_code?: string | null
  score: number
  reconnect_token?: string
  joined_at: string
}

export interface Answer {
  id: string
  player_id: string
  question_id: string
  selected_option: number
  is_correct: boolean
  time_taken: number
  points_earned: number
  created_at: string
}
