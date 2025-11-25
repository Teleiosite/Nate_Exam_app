import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Exam, StudentSubmission, QuestionType, EngineeringDepartment, Responses, Answer } from '../types';
import Timer from './Timer';
import QuestionNavigator from './QuestionNavigator';
import QuestionDisplay from './QuestionDisplay';
import Modal from './Modal';
import Toast from './Toast';
import ResultsPage from './ResultsPage';
import { useProctoring } from '../hooks/useProctoring';
import { useAuth } from '../context/AuthContext';
import Certificate from './Certificate';

interface TakeExamProps {
    exam: Exam;
    onBackToDashboard: () => void;
}

const TakeExam: React.FC<TakeExamProps> = ({ exam, onBackToDashboard }) => {
    const { user, logout } = useAuth();
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [responses, setResponses] = useState<Responses>({});
    const [flaggedQuestions, setFlaggedQuestions] = useState<Set<string>>(new Set());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    const [examFinished, setExamFinished] = useState(false);
    const [proctoringWarning, setProctoringWarning] = useState('');
    const [startTime, setStartTime] = useState<Date | null>(null);
    const [timeTaken, setTimeTaken] = useState(0); // in seconds
    const [timeLeft, setTimeLeft] = useState(exam.durationMinutes * 60);
    const [retakeCount, setRetakeCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [finalSubmission, setFinalSubmission] = useState<StudentSubmission | null>(null);

    const [assignmentId, setAssignmentId] = useState<string | null>(null);
    const [fullExam, setFullExam] = useState<Exam>(exam); // Store full exam with questions

    const submissionKey = useMemo(() => `submission_${user?.id}_${exam.id}`, [user, exam.id]);

    // Fetch full exam details with questions
    useEffect(() => {
        const fetchExamDetails = async () => {
            console.log("Fetching exam details for exam ID:", exam.id);
            const token = localStorage.getItem('access_token');
            try {
                const res = await fetch(`/api/exams/${exam.id}/`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (res.ok) {
                    const examData = await res.json();
                    console.log("Fetched exam data:", examData);
                    console.log("Raw questions from backend:", examData.questions);
                    // Map backend exam to frontend format
                    const mappedExam: Exam = {
                        id: examData.id,
                        title: examData.title,
                        durationMinutes: examData.duration_minutes,
                        retakeLimit: examData.retake_limit,
                        instructorId: examData.instructor.id,
                        instructorName: `${examData.instructor.first_name} ${examData.instructor.last_name}`,
                        department: examData.specialization?.name as EngineeringDepartment,
                        questions: (examData.questions || []).map((q: any) => {
                            console.log(`Mapping question ${q.id}:`, q);
                            console.log(`  - Type: ${q.question_type}`);
                            console.log(`  - Options count: ${q.options?.length || 0}`);
                            console.log(`  - Options:`, q.options);
                            return {
                                id: q.id,
                                text: q.question_text,
                                questionType: q.question_type as QuestionType,
                                points: parseFloat(q.points),
                                orderIndex: q.order_index,
                                options: (q.options || []).map((o: any) => ({
                                    id: o.id,
                                    text: o.option_text,
                                    isCorrect: o.is_correct
                                }))
                            };
                        }).sort((a: any, b: any) => a.orderIndex - b.orderIndex)
                    };
                    console.log("Mapped exam with questions:", mappedExam.questions.length, "questions");
                    console.log("Full mapped exam:", mappedExam);
                    setFullExam(mappedExam);
                } else {
                    console.error("Failed to fetch exam details - Status:", res.status);
                }
            } catch (e) {
                console.error("Failed to fetch exam details", e);
            }
        };

        // Always fetch details if questions are missing or are placeholders
        console.log("TakeExam - exam.questions:", exam.questions);
        const needsFetch = exam.questions.length === 0 ||
            (exam.questions.length > 0 && exam.questions[0].id.startsWith('placeholder-')) ||
            !exam.questions[0]?.text; // Also fetch if first question has no text

        console.log("Needs fetch?", needsFetch);
        if (needsFetch) {
            fetchExamDetails();
        } else {
            console.log("Using exam prop directly");
            setFullExam(exam);
        }
    }, [exam]);

    const logActivity = useCallback((activityType: string) => {
        console.log(`Suspicious Activity Detected: ${activityType}`);
        const message = `Warning: ${activityType.replace(/_/g, ' ')} detected.`;
        setProctoringWarning(message);

        // Log to backend
        if (assignmentId) {
            const token = localStorage.getItem('access_token');
            fetch('/api/submissions/suspicious_activity/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    assignment_id: assignmentId,
                    activity_type: activityType,
                    severity: 'medium' // Default severity
                })
            }).catch(err => console.error("Failed to log activity", err));
        }
    }, [assignmentId]);

    useProctoring(logActivity);

    // Start or Resume Exam
    useEffect(() => {
        const startExam = async () => {
            const token = localStorage.getItem('access_token');
            try {
                const res = await fetch('/api/submissions/exam_assignments/start_new/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ exam_id: exam.id })
                });

                if (res.ok) {
                    const assignment = await res.json();
                    setAssignmentId(assignment.id);

                    // If already submitted/graded, show results
                    if (assignment.status === 'submitted' || assignment.status === 'graded') {
                        setFinalSubmission({
                            responses: {}, // We might need to fetch responses separately if not in assignment details
                            timeTaken: 0, // TODO: Calculate from start/submit times
                            retakeCount: assignment.retake_count || 0,
                            score: assignment.score,
                            maxScore: exam.totalPoints, // Or calculate
                            submissionDate: new Date(assignment.submitted_at).toLocaleDateString()
                        });
                        setExamFinished(true);
                    } else {
                        // Resume logic: Populate existing responses
                        if (assignment.responses && assignment.responses.length > 0) {
                            const loadedResponses: Responses = {};
                            assignment.responses.forEach((r: any) => {
                                if (r.is_answered) {
                                    // Determine if it's text or options based on what's present
                                    // Ideally we check question type, but here we just look at data
                                    if (r.answer_options && r.answer_options.length > 0) {
                                        // If multiple options, return array. If one, return string (for single choice)
                                        // BUT our frontend expects array for multiple select and string for single choice.
                                        // We need to know the question type to be sure, or infer.
                                        // Let's check the question ID in the exam prop to find type.
                                        const q = exam.questions.find(q => q.id === r.question);
                                        if (q) {
                                            if (q.questionType === QuestionType.MultipleChoice) {
                                                loadedResponses[r.question] = r.answer_options[0];
                                            } else {
                                                loadedResponses[r.question] = r.answer_options;
                                            }
                                        } else {
                                            // Fallback
                                            loadedResponses[r.question] = r.answer_options.length === 1 ? r.answer_options[0] : r.answer_options;
                                        }
                                    } else if (r.answer_text) {
                                        loadedResponses[r.question] = r.answer_text;
                                    }
                                }
                            });
                            setResponses(loadedResponses);
                        }
                        setStartTime(new Date());
                    }
                } else {
                    console.error("Failed to start exam");
                }
            } catch (e) {
                console.error("Error starting exam", e);
            }
            setIsLoading(false);
        };
        startExam();
    }, [exam.id]);

    // Auto-save logic (optional, or rely on per-answer save)
    // We will save per answer for now.

    const handleNext = () => {
        if (fullExam && currentQuestionIndex < fullExam.questions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
    };

    const handlePrev = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
    };

    const handleNavigateTo = (index: number) => {
        if (fullExam && index >= 0 && index < fullExam.questions.length) {
            setCurrentQuestionIndex(index);
        }
    };

    const handleAnswerChange = async (answer: Answer) => {
        if (!fullExam) return;
        const questionId = fullExam.questions[currentQuestionIndex].id;

        // ALWAYS update local state immediately for responsive UI
        setResponses(prev => ({ ...prev, [questionId]: answer }));

        // Try to submit to backend if assignment exists, but don't block user input if it doesn't
        if (!assignmentId) {
            console.log("No assignmentId yet, answer saved locally only");
            return;
        }

        // Update local state for results display
        setResponses(prev => ({
            ...prev,
            [questionId]: answer
        }));

        // Submit answer to backend
        const token = localStorage.getItem('access_token');
        try {
            // Format answer for backend
            let answerData: any = {};
            if (typeof answer === 'string') {
                // Check if it's an option ID or text
                // For MCQ/Select, we expect option IDs. For Text, text.
                // Our frontend types are a bit mixed.
                // Let's assume if it matches an option ID format (or we check question type)
                const q = fullExam.questions[currentQuestionIndex];
                if (q.questionType === QuestionType.ShortAnswer || q.questionType === QuestionType.Essay) {
                    answerData = { answer_text: answer };
                } else {
                    answerData = { answer_options: [answer] };
                }
            } else if (Array.isArray(answer)) {
                answerData = { answer_options: answer };
            }

            await fetch(`/api/submissions/exam_assignments/${assignmentId}/submit-answer/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    question_id: questionId,
                    ...answerData
                })
            });
        } catch (e) {
            console.error("Failed to save answer", e);
        }
    };

    const handleFlagToggle = () => {
        if (!exam) return;
        const questionId = exam.questions[currentQuestionIndex].id;
        setFlaggedQuestions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(questionId)) {
                newSet.delete(questionId);
            } else {
                newSet.add(questionId);
            }
            return newSet;
        });
    };

    const finishExam = useCallback(async (currentResponses: Responses) => {
        if (!assignmentId) return;

        const token = localStorage.getItem('access_token');
        try {
            const res = await fetch(`/api/submissions/exam_assignments/${assignmentId}/submit/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (res.ok) {
                const result = await res.json();
                const submissionData: StudentSubmission = {
                    responses: currentResponses,
                    timeTaken: timeTaken, // Should calculate real duration
                    retakeCount: retakeCount,
                    score: result.score || 0,
                    maxScore: exam.totalPoints || 100,
                    submissionDate: new Date().toLocaleDateString()
                };
                setFinalSubmission(submissionData);
                setExamFinished(true);
            }
        } catch (e) {
            console.error("Failed to submit exam", e);
        }
    }, [assignmentId, timeTaken, retakeCount, exam.totalPoints]);

    const handleSubmit = useCallback(() => {
        setIsSubmitting(true);
        finishExam(responses).finally(() => {
            setIsSubmitting(false);
            setIsSubmitModalOpen(false);
        });
    }, [finishExam, responses]);

    const handleTimeExpired = useCallback(() => {
        console.log("Time's up! Auto-submitting...");
        if (!examFinished) {
            setResponses(currentResponses => {
                finishExam(currentResponses);
                return currentResponses;
            });
        }
    }, [examFinished, finishExam]);

    const currentQuestion = useMemo(() => fullExam?.questions[currentQuestionIndex], [fullExam, currentQuestionIndex]);

    const handleRetakeExam = () => {
        if (retakeCount < fullExam.retakeLimit) {
            const newRetakeCount = retakeCount + 1;
            setRetakeCount(newRetakeCount);

            const submissionData: Partial<StudentSubmission> = {
                retakeCount: newRetakeCount
            };
            localStorage.setItem(submissionKey, JSON.stringify(submissionData));

            setResponses({});
            setFinalSubmission(null);
            setFlaggedQuestions(new Set());
            setCurrentQuestionIndex(0);
            setExamFinished(false);
            setIsSubmitting(false);
            setStartTime(new Date());
            setTimeTaken(0);
        }
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen text-xl">Loading Exam Data...</div>;
    }

    if (examFinished && finalSubmission) {
        return (
            <ResultsPage
                exam={exam}
                responses={finalSubmission.responses}
                timeTaken={finalSubmission.timeTaken}
                retakeCount={finalSubmission.retakeCount}
                onRetake={handleRetakeExam}
                onBackToDashboard={onBackToDashboard}
                onViewCertificate={onBackToDashboard} // In a real app, you might show a modal or navigate
            />
        );
    }

    return (
        <div className="p-2 sm:p-4 lg:p-6 flex flex-col min-h-screen">
            <Toast message={proctoringWarning} show={!!proctoringWarning} onDismiss={() => setProctoringWarning('')} />
            <header className="flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4 mb-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl md:text-2xl font-bold text-white truncate">{fullExam.title}</h1>
                    <p className="text-sm text-gray-400 mt-1">Welcome, {user?.firstName}</p>
                </div>
                <div className="flex items-center space-x-4">
                    <Timer initialMinutes={fullExam.durationMinutes} onTimeExpired={handleTimeExpired} />
                    <button
                        onClick={() => setIsSubmitModalOpen(true)}
                        className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-500 text-white font-bold transition shadow-lg"
                    >
                        Submit Exam
                    </button>
                    <button onClick={onBackToDashboard} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition">
                        Exit
                    </button>
                </div>
            </header>

            <main className="flex-grow flex flex-col md:flex-row gap-4 min-h-0">
                <div className="w-full md:w-2/3 lg:w-3/4 flex flex-col">
                    {currentQuestion && (
                        <QuestionDisplay
                            question={currentQuestion}
                            questionNumber={currentQuestionIndex + 1}
                            totalQuestions={fullExam.questions.length}
                            currentAnswer={responses[currentQuestion.id]}
                            onAnswerChange={handleAnswerChange}
                            isFlagged={flaggedQuestions.has(currentQuestion.id)}
                            onFlagToggle={handleFlagToggle}
                        />
                    )}
                    <div className="flex-shrink-0 flex justify-between items-center p-4 mt-4 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg">
                        <button
                            onClick={handlePrev}
                            disabled={currentQuestionIndex === 0}
                            className="px-6 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        <div className="text-xs text-gray-400">Use Arrow keys to navigate</div>
                        <button
                            onClick={handleNext}
                            disabled={currentQuestionIndex === fullExam.questions.length - 1}
                            className="px-6 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                </div>
                <aside className="w-full md:w-1/3 lg:w-1/4">
                    <QuestionNavigator
                        questions={fullExam.questions}
                        currentQuestionIndex={currentQuestionIndex}
                        responses={responses}
                        flaggedQuestions={flaggedQuestions}
                        onNavigate={handleNavigateTo}
                    />
                </aside>
            </main>

            <Modal
                isOpen={isSubmitModalOpen}
                onClose={() => setIsSubmitModalOpen(false)}
                onConfirm={handleSubmit}
                title="Confirm Submission"
                confirmText={isSubmitting ? 'Submitting...' : 'Yes, Submit'}
            >
                <p>Are you sure you want to submit your exam? You will not be able to change your answers after submission.</p>
            </Modal>
        </div>
    );
};

export default TakeExam;