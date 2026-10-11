import React from 'react';
import { useTranslation } from 'react-i18next';
import { ContentInterface } from '@type/chat';
import PopupModal from '@components/PopupModal';
import EditViewButtons from './EditViewButtons';
import { useEditViewLogic } from './useEditViewLogic';
import OverTypeEditor from './OverTypeEditor';

export const MessageEditForm = ({ logic, role, messageIndex, sticky = false, autoFocus = true, editorClassName }: {
  logic: ReturnType<typeof useEditViewLogic>;
  role?: string;
  messageIndex: number;
  sticky?: boolean;
  autoFocus?: boolean;
  editorClassName?: string;
}) => {
  const { t } = useTranslation();
  const stickySurfaceClass = 'rounded-2xl bg-white/60 px-4 pt-2.5 pb-2.5 shadow-sm ring-1 ring-black/5 dark:bg-gray-900/20 dark:ring-white/10 md:px-5 md:pt-3 md:pb-3';
  return (
    <div className='relative'>
      <div
        className={`w-full ${
          sticky
            ? stickySurfaceClass
            : ''
        }`}
      >
        <div className={editorClassName}>
          <OverTypeEditor
            value={logic.textValue}
            mode='edit'
            onChange={logic.setTextValue}
            onKeyDown={(e) => {
              logic.handleKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
            }}
            onPaste={(e) => {
              logic.handlePaste(e as unknown as React.ClipboardEvent<HTMLTextAreaElement>);
            }}
            placeholder={sticky ? t('submitPlaceholder') as string : undefined}
            autoFocus={autoFocus}
            autoResize={sticky}
            minHeight='5.25rem'
          />
        </div>
        {sticky && (
          <EditViewButtons {...logic} sticky={sticky} messageIndex={messageIndex} role={role} />
        )}
      </div>
      {!sticky && <EditViewButtons {...logic} sticky={false} messageIndex={messageIndex} role={role} />}
      {logic.isModalOpen && (
        <PopupModal
          setIsModalOpen={logic.setIsModalOpen}
          title={t('warning') as string}
          message={t('clearMessageWarning') as string}
          handleConfirm={logic.handleGenerate}
        />
      )}
      {logic.isUnknownContextConfirmOpen && (
        <PopupModal
          setIsModalOpen={logic.setIsUnknownContextConfirmOpen}
          title={t('warning') as string}
          message={logic.unknownContextConfirmMessage}
          handleConfirm={logic.handleUnknownContextConfirm}
          handleClose={logic.handleUnknownContextCancel}
        />
      )}
    </div>
  );
};

const EditView = ({
  role,
  content,
  setIsEdit,
  messageIndex,
  nodeId,
  sticky,
  editSessionKey,
  autoFocus = true,
}: {
  role?: string;
  content: ContentInterface[];
  setIsEdit: React.Dispatch<React.SetStateAction<boolean>>;
  messageIndex: number;
  nodeId?: string;
  sticky?: boolean;
  editSessionKey: string;
  autoFocus?: boolean;
}) => {
  const logic = useEditViewLogic({ content, setIsEdit, messageIndex, nodeId, sticky, editSessionKey });
  return <MessageEditForm logic={logic} role={role} messageIndex={messageIndex} sticky={sticky} autoFocus={autoFocus} />;
};

export default EditView;
