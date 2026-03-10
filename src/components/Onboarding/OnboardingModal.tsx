import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import useStore from '@store/store';
import CrossIcon2 from '@icon/CrossIcon2';

const TOTAL_STEPS = 4;

const OnboardingModal = () => {
  const { t } = useTranslation();
  const onboardingCompleted = useStore((state) => state.onboardingCompleted);
  const setOnboardingCompleted = useStore((state) => state.setOnboardingCompleted);
  const setShowProviderMenu = useStore((state) => state.setShowProviderMenu);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const modalRoot = document.getElementById('modal-root');

  if (onboardingCompleted || dismissed || !modalRoot) return null;

  const handleComplete = () => {
    setOnboardingCompleted(true);
    setDismissed(true);
    // Open provider menu so user can set up API key right away
    setShowProviderMenu(true);
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleNext = () => {
    if (step >= TOTAL_STEPS - 1) {
      handleComplete();
    } else {
      setStep(step + 1);
    }
  };

  const steps = [
    {
      title: t('onboarding.welcome.title'),
      content: (
        <div className='flex flex-col items-center gap-4 text-center'>
          <div className='text-4xl'>&#10024;</div>
          <p className='text-gray-700 dark:text-gray-300'>
            {t('onboarding.welcome.description')}
          </p>
        </div>
      ),
    },
    {
      title: t('onboarding.apiSetup.title'),
      content: (
        <div className='flex flex-col gap-3'>
          <p className='text-gray-700 dark:text-gray-300'>
            {t('onboarding.apiSetup.description')}
          </p>
          <div className='bg-gray-100 dark:bg-gray-600 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-300'>
            {t('onboarding.apiSetup.hint')}
          </div>
        </div>
      ),
    },
    {
      title: t('onboarding.modelSelection.title'),
      content: (
        <div className='flex flex-col gap-3'>
          <p className='text-gray-700 dark:text-gray-300'>
            {t('onboarding.modelSelection.description')}
          </p>
          <div className='bg-gray-100 dark:bg-gray-600 rounded-lg p-3 text-sm text-gray-600 dark:text-gray-300'>
            {t('onboarding.modelSelection.hint')}
          </div>
        </div>
      ),
    },
    {
      title: t('onboarding.gettingStarted.title'),
      content: (
        <div className='flex flex-col gap-3'>
          <ul className='list-disc list-inside text-gray-700 dark:text-gray-300 space-y-2'>
            <li>{t('onboarding.gettingStarted.tip1')}</li>
            <li>{t('onboarding.gettingStarted.tip2')}</li>
            <li>{t('onboarding.gettingStarted.tip3')}</li>
            <li>{t('onboarding.gettingStarted.tip4')}</li>
          </ul>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];

  return ReactDOM.createPortal(
    <div className='fixed top-0 left-0 z-[999] w-full p-4 overflow-x-hidden overflow-y-auto h-full flex justify-center items-center'>
      <div className='relative z-2 w-full max-w-md'>
        <div className='bg-gray-50 rounded-lg shadow dark:bg-gray-700'>
          <div className='flex items-center justify-between p-4 border-b dark:border-gray-600'>
            <h3 className='ml-2 text-lg font-semibold text-gray-900 dark:text-white'>
              {currentStep.title}
            </h3>
            <button
              type='button'
              className='text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 ml-auto inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white'
              onClick={handleSkip}
              aria-label='close'
            >
              <CrossIcon2 />
            </button>
          </div>

          <div className='p-6 min-h-[240px] flex items-start'><div className='w-full'>{currentStep.content}</div></div>

          {/* Step indicators */}
          <div className='flex justify-center gap-1.5 pb-2'>
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step
                    ? 'bg-blue-500'
                    : i < step
                    ? 'bg-blue-300 dark:bg-blue-700'
                    : 'bg-gray-300 dark:bg-gray-500'
                }`}
              />
            ))}
          </div>

          <div className='flex items-center justify-between p-4'>
            {step > 0 ? (
              <button
                type='button'
                className='btn btn-primary'
                onClick={() => setStep(step - 1)}
              >
                {t('onboarding.back')}
              </button>
            ) : (
              <div />
            )}
            <div className='flex items-center gap-4'>
              <button
                type='button'
                className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={handleSkip}
              >
                {t('onboarding.skip')}
              </button>
              <button
                type='button'
                className='btn btn-primary'
                onClick={handleNext}
              >
                {step >= TOTAL_STEPS - 1
                  ? t('onboarding.startChatting')
                  : t('onboarding.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        className='bg-gray-800/90 absolute top-0 left-0 h-full w-full z-[-1]'
        onClick={handleSkip}
      />
    </div>,
    modalRoot
  );
};

export default OnboardingModal;
