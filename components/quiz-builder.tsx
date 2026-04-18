'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup, Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Zap, ArrowLeft, Plus, Trash2, Save, GripVertical, Upload, Download } from 'lucide-react'
import type { Quiz, Question, QuestionOption } from '@/lib/types'

interface QuizBuilderProps {
  userId: string
  existingQuiz?: Quiz & { questions: Question[] }
}

interface QuestionForm {
  id?: string
  question_text: string
  question_type: 'multiple_choice' | 'true_false'
  options: QuestionOption[]
  time_limit: number
  points: number
}

const DEFAULT_QUESTION: QuestionForm = {
  question_text: '',
  question_type: 'multiple_choice',
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
  time_limit: 20,
  points: 1000,
}

const TRUE_FALSE_OPTIONS: QuestionOption[] = [
  { text: 'True', isCorrect: true },
  { text: 'False', isCorrect: false },
]

export function QuizBuilder({ userId, existingQuiz }: QuizBuilderProps) {
  const [title, setTitle] = useState(existingQuiz?.title || '')
  const [description, setDescription] = useState(existingQuiz?.description || '')
  const [questions, setQuestions] = useState<QuestionForm[]>(
    existingQuiz?.questions.map(q => ({
      id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options as QuestionOption[],
      time_limit: q.time_limit,
      points: q.points,
    })) || [{ ...DEFAULT_QUESTION }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const supabase = createClient()

  const addQuestion = () => {
    setQuestions([...questions, { ...DEFAULT_QUESTION }])
  }

  const removeQuestion = (index: number) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index))
    }
  }

  const updateQuestion = (index: number, updates: Partial<QuestionForm>) => {
    const newQuestions = [...questions]
    newQuestions[index] = { ...newQuestions[index], ...updates }
    setQuestions(newQuestions)
  }

  const updateOption = (questionIndex: number, optionIndex: number, text: string) => {
    const newQuestions = [...questions]
    const newOptions = [...newQuestions[questionIndex].options]
    newOptions[optionIndex] = { ...newOptions[optionIndex], text }
    newQuestions[questionIndex].options = newOptions
    setQuestions(newQuestions)
  }

  const setCorrectOption = (questionIndex: number, optionIndex: number) => {
    const newQuestions = [...questions]
    const newOptions = newQuestions[questionIndex].options.map((opt, i) => ({
      ...opt,
      isCorrect: i === optionIndex,
    }))
    newQuestions[questionIndex].options = newOptions
    setQuestions(newQuestions)
  }

  const changeQuestionType = (index: number, type: 'multiple_choice' | 'true_false') => {
    const newQuestions = [...questions]
    newQuestions[index].question_type = type
    if (type === 'true_false') {
      newQuestions[index].options = [...TRUE_FALSE_OPTIONS]
    } else {
      newQuestions[index].options = [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
      ]
    }
    setQuestions(newQuestions)
  }

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string)
        // Support both { title, description, questions: [...] } and a bare array
        const isWrapped = !Array.isArray(raw) && Array.isArray(raw.questions)
        const rawQuestions: unknown[] = isWrapped ? raw.questions : raw

        if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
          setError('JSON must contain a non-empty "questions" array.')
          return
        }

        const parsed: QuestionForm[] = rawQuestions.map((q: unknown, i: number) => {
          const qObj = q as Record<string, unknown>
          if (!qObj.question_text || typeof qObj.question_text !== 'string') {
            throw new Error(`Question ${i + 1} is missing "question_text"`)
          }
          const type: 'multiple_choice' | 'true_false' =
            qObj.question_type === 'true_false' ? 'true_false' : 'multiple_choice'
          const options: QuestionOption[] =
            type === 'true_false'
              ? [...TRUE_FALSE_OPTIONS]
              : (Array.isArray(qObj.options) ? qObj.options : []).map((o: unknown) => {
                  const oObj = o as Record<string, unknown>
                  return { text: String(oObj.text ?? ''), isCorrect: Boolean(oObj.isCorrect) }
                })
          return {
            question_text: qObj.question_text,
            question_type: type,
            options,
            time_limit: typeof qObj.time_limit === 'number' ? qObj.time_limit : 20,
            points: typeof qObj.points === 'number' ? qObj.points : 1000,
          }
        })

        if (isWrapped) {
          if (raw.title) setTitle(raw.title)
          if (raw.description) setDescription(raw.description)
        }
        setQuestions(parsed)
        setError(null)
      } catch (err) {
        setError(`Invalid JSON: ${err instanceof Error ? err.message : 'unknown error'}`)
      }
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const template = {
      title: 'My Quiz Title',
      description: 'Optional description',
      questions: [
        {
          question_text: 'What is the capital of France?',
          question_type: 'multiple_choice',
          options: [
            { text: 'Berlin', isCorrect: false },
            { text: 'Paris', isCorrect: true },
            { text: 'Madrid', isCorrect: false },
            { text: 'Rome', isCorrect: false },
          ],
          time_limit: 20,
          points: 1000,
        },
        {
          question_text: 'The Earth is flat.',
          question_type: 'true_false',
          time_limit: 15,
          points: 500,
        },
      ],
    }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quiz-template.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async () => {
    setError(null)
    
    // Validation
    if (!title.trim()) {
      setError('Please enter a quiz title')
      return
    }
    
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (!q.question_text.trim()) {
        setError(`Question ${i + 1} is empty`)
        return
      }
      if (q.question_type === 'multiple_choice') {
        const filledOptions = q.options.filter(o => o.text.trim())
        if (filledOptions.length < 2) {
          setError(`Question ${i + 1} needs at least 2 answer options`)
          return
        }
      }
    }

    setSaving(true)

    try {
      let quizId = existingQuiz?.id

      if (existingQuiz) {
        // Update existing quiz
        const { error: quizError } = await supabase
          .from('quizzes')
          .update({ title, description, updated_at: new Date().toISOString() })
          .eq('id', existingQuiz.id)

        if (quizError) throw quizError

        // Delete existing questions
        await supabase.from('questions').delete().eq('quiz_id', existingQuiz.id)
      } else {
        // Create new quiz
        const { data: quiz, error: quizError } = await supabase
          .from('quizzes')
          .insert({ host_id: userId, title, description })
          .select()
          .single()

        if (quizError) throw quizError
        quizId = quiz.id
      }

      // Insert questions
      const questionsToInsert = questions.map((q, index) => ({
        quiz_id: quizId,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.question_type === 'true_false' 
          ? q.options 
          : q.options.filter(o => o.text.trim()),
        time_limit: q.time_limit,
        points: q.points,
        order_index: index,
      }))

      const { error: questionsError } = await supabase
        .from('questions')
        .insert(questionsToInsert)

      if (questionsError) throw questionsError

      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      console.error('Error saving quiz:', err)
      setError('Failed to save quiz. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Zap className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold">
                {existingQuiz ? 'Edit Quiz' : 'Create Quiz'}
              </span>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save Quiz'}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
            {error}
          </div>
        )}

        {/* Quiz Details */}
        <Card className="bg-card/50 mb-8">
          <CardHeader>
            <CardTitle>Quiz Details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input
                  id="title"
                  placeholder="Enter quiz title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-secondary"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
                <Textarea
                  id="description"
                  placeholder="Add a description for your quiz"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-secondary resize-none"
                  rows={3}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Questions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Questions</h2>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={downloadTemplate} title="Download JSON template">
                <Download className="mr-2 h-4 w-4" />
                Template
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import JSON
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleJsonImport}
              />
              <Button variant="outline" onClick={addQuestion}>
                <Plus className="mr-2 h-4 w-4" />
                Add Question
              </Button>
            </div>
          </div>

          {questions.map((question, qIndex) => (
            <Card key={qIndex} className="bg-card/50">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">Question {qIndex + 1}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={question.question_type}
                      onValueChange={(value) => changeQuestionType(qIndex, value as 'multiple_choice' | 'true_false')}
                    >
                      <SelectTrigger className="w-40 bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                        <SelectItem value="true_false">True / False</SelectItem>
                      </SelectContent>
                    </Select>
                    {questions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQuestion(qIndex)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field>
                  <FieldLabel>Question Text</FieldLabel>
                  <Textarea
                    placeholder="Enter your question"
                    value={question.question_text}
                    onChange={(e) => updateQuestion(qIndex, { question_text: e.target.value })}
                    className="bg-secondary resize-none"
                    rows={2}
                  />
                </Field>

                <div>
                  <FieldLabel className="mb-3">Answer Options</FieldLabel>
                  <div className="grid gap-2">
                    {question.options.map((option, oIndex) => (
                      <div key={oIndex} className="flex items-center gap-3">
                        <div 
                          className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold shrink-0 ${
                            option.isCorrect 
                              ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {String.fromCharCode(65 + oIndex)}
                        </div>
                        {question.question_type === 'true_false' ? (
                          <div className="flex-1 h-10 px-3 rounded-md bg-secondary flex items-center">
                            {option.text}
                          </div>
                        ) : (
                          <Input
                            placeholder={`Option ${String.fromCharCode(65 + oIndex)}`}
                            value={option.text}
                            onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                            className="flex-1 bg-secondary"
                          />
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Correct</span>
                          <Switch
                            checked={option.isCorrect}
                            onCheckedChange={() => setCorrectOption(qIndex, oIndex)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel>Time Limit (seconds)</FieldLabel>
                    <Select
                      value={question.time_limit.toString()}
                      onValueChange={(value) => updateQuestion(qIndex, { time_limit: parseInt(value) })}
                    >
                      <SelectTrigger className="bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 seconds</SelectItem>
                        <SelectItem value="15">15 seconds</SelectItem>
                        <SelectItem value="20">20 seconds</SelectItem>
                        <SelectItem value="30">30 seconds</SelectItem>
                        <SelectItem value="45">45 seconds</SelectItem>
                        <SelectItem value="60">60 seconds</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Points</FieldLabel>
                    <Select
                      value={question.points.toString()}
                      onValueChange={(value) => updateQuestion(qIndex, { points: parseInt(value) })}
                    >
                      <SelectTrigger className="bg-secondary">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="500">500 points</SelectItem>
                        <SelectItem value="1000">1000 points</SelectItem>
                        <SelectItem value="1500">1500 points</SelectItem>
                        <SelectItem value="2000">2000 points</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={addQuestion} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add Another Question
          </Button>
        </div>
      </main>
    </div>
  )
}
