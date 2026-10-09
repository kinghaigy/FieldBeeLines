(vl-load-com)

;; ==============================================================================
;; MAIN COMMAND: BAKETODXF
;; Bakes XREFs, preserves blocks, strips hatches/bloat, processes text, saves DXF.
;; ==============================================================================
(defun BTD:LayerVisibleP (layerName / layerData)
  (setq layerData (tblsearch "LAYER" layerName))
  (and layerData
       (= 0 (logand 1 (cdr (assoc 70 layerData))))
       (> (cdr (assoc 62 layerData)) 0))
)

(defun BTD:UnbindLayerName (layerName / cursor start finish digits result)
  (setq cursor 0 result "")
  (while (setq start (vl-string-search "$" layerName cursor))
    (setq finish (vl-string-search "$" layerName (1+ start))
          digits (if finish (substr layerName (+ start 2) (- finish start 1))))
    (if (and digits (> (strlen digits) 0) (not (wcmatch digits "*[~0-9]*")))
      (progn
        (setq result (strcat result (substr layerName (1+ cursor) (- start cursor)) "|")
              cursor (1+ finish)))
      (setq result (strcat result (substr layerName (1+ cursor) (1+ (- start cursor))))
            cursor (1+ start))
    )
  )
  (strcat result (substr layerName (1+ cursor)))
)

(defun BTD:Check (result message)
  (if (vl-catch-all-error-p result)
    (progn
      (princ (strcat "\n" message ": " (vl-catch-all-error-message result)))
      (exit)
    )
  )
  result
)

(defun BTD:PruneHiddenGeometry (doc / blk obj objects layerName entData removed)
  (setq objects nil removed 0)
  (vlax-for blk (vla-get-Blocks doc)
    (if (= (vla-get-IsXRef blk) :vlax-false)
      (vlax-for obj blk
        (setq layerName (vla-get-Layer obj)
              entData (entget (vlax-vla-object->ename obj)))
        (if (or (not (BTD:LayerVisibleP layerName))
                (= (cdr (assoc 0 entData)) "HATCH"))
          (setq objects (cons obj objects))
        )
      )
    )
  )
  (foreach obj objects
    (BTD:Check (vl-catch-all-apply 'vla-Delete (list obj))
               "Unable to remove hidden-layer geometry or hatch; export cancelled")
    (setq removed (1+ removed))
  )
  removed
)

(defun c:BAKETODXF ( / *error* BTD:Cleanup dxfPath tempPath backupPath oldFiledia oldCmddia
                        blkData blkName flags loadedXrefs xrefName doc layer undoMarked
                        rollbackResult cleanupOK layerName hiddenLayers sourceLayers )

  (defun BTD:Cleanup ( / result )
    (setq cleanupOK T)
    (if undoMarked
      (progn
        (setq undoMarked nil
              rollbackResult (vl-catch-all-apply 'command-s (list "_.UNDO" "_Back")))
        (if (vl-catch-all-error-p rollbackResult)
          (progn
            (setq cleanupOK nil)
            (princ (strcat "\nWARNING: Drawing rollback failed: "
                           (vl-catch-all-error-message rollbackResult)
                           ". Inspect the drawing and use UNDO manually. Do not save temporary changes."))
          )
        )
      )
    )
    (if oldFiledia
      (progn
        (setq result (vl-catch-all-apply 'setvar (list "FILEDIA" oldFiledia)))
        (if (vl-catch-all-error-p result)
          (progn (setq cleanupOK nil) (princ "\nWARNING: Restore FILEDIA manually.")))
      )
    )
    (if oldCmddia
      (progn
        (setq result (vl-catch-all-apply 'setvar (list "CMDDIA" oldCmddia)))
        (if (vl-catch-all-error-p result)
          (progn (setq cleanupOK nil) (princ "\nWARNING: Restore CMDDIA manually.")))
      )
    )
    (if (and tempPath (findfile tempPath))
      (progn
        (setq result (vl-catch-all-apply 'vl-file-delete (list tempPath)))
        (if (or (vl-catch-all-error-p result) (not result))
        (princ (strcat "\nTemporary DXF remains at: " tempPath)))
      )
    )
    (if (and backupPath (findfile backupPath))
      (if (not (findfile dxfPath))
        (progn
          (setq result (vl-catch-all-apply 'vl-file-rename (list backupPath dxfPath)))
          (if (or (vl-catch-all-error-p result) (not result))
            (princ (strcat "\nOriginal destination preserved at: " backupPath))))
        (princ (strcat "\nOriginal destination backup remains at: " backupPath))
      )
    )
    cleanupOK
  )

  (defun *error* (message)
    (BTD:Cleanup)
    (if message (princ (strcat "\nBAKETODXF stopped: " message)))
    (princ)
  )

  (setq dxfPath (getfiled "Save As ASCII DXF" (getvar "DWGPREFIX") "dxf" 1))

  (if dxfPath
    (progn
      (if (or (= 0 (logand 1 (getvar "UNDOCTL")))
              (/= 0 (logand 2 (getvar "UNDOCTL")))
              (/= 0 (logand 8 (getvar "UNDOCTL"))))
        (progn
          (princ "\nEnable full UNDO and close any active UNDO group before exporting.")
          (exit)
        )
      )
      ;; 1. Setup UI variables
      (setq oldFiledia (getvar "FILEDIA")
            oldCmddia (getvar "CMDDIA"))

      (setvar "FILEDIA" 0)
      (setvar "CMDDIA" 0)

      ;; 2. Set UNDO Mark (The Ghost Method)
      (vl-cmdf "_.UNDO" "_Mark")
      (setq undoMarked T
            doc (vla-get-ActiveDocument (vlax-get-acad-object))
            hiddenLayers nil
            sourceLayers nil)
      (vlax-for layer (vla-get-Layers doc)
        (setq layerName (vla-get-Name layer))
        (setq sourceLayers (cons layerName sourceLayers))
        (if (not (BTD:LayerVisibleP layerName))
          (setq hiddenLayers (cons layerName hiddenLayers)))
        (if (= (vla-get-Lock layer) :vlax-true)
          (BTD:Check (vl-catch-all-apply 'vla-put-Lock (list layer :vlax-false))
                     "Unable to temporarily unlock a layer")
        )
      )
      (princ "\nRemoving off/frozen-layer objects before binding...")
      (BTD:PruneHiddenGeometry doc)
      (princ "\nProcessing XREFs...")

      ;; 3. Check for LOADED XREFs only
      (setq loadedXrefs nil)
      (setq blkData (tblnext "BLOCK" T))

      (while blkData
        (setq blkName (cdr (assoc 2 blkData))
              flags (cdr (assoc 70 blkData)))

        (if (and (= (logand 4 flags) 4) (= (logand 32 flags) 32))
          (setq loadedXrefs (cons blkName loadedXrefs))
        )
        (setq blkData (tblnext "BLOCK"))
      )

      ;; 4. Bind the loaded XREFs
      (if loadedXrefs
        (progn
          (princ (strcat "\nFound " (itoa (length loadedXrefs)) " loaded XREF(s). Binding now..."))
          (foreach xrefName loadedXrefs
            (vl-cmdf "_.-XREF" "_Bind" xrefName)
          )
        )
      )

      (vlax-for layer (vla-get-Layers doc)
        (setq layerName (vla-get-Name layer))
        (if (or (member layerName hiddenLayers)
                (and (not (member layerName sourceLayers))
                     (member (BTD:UnbindLayerName layerName) hiddenLayers)))
          (BTD:Check (vl-catch-all-apply 'vla-put-LayerOn (list layer :vlax-false))
                     "Unable to preserve a hidden XREF layer")
        )
        (if (= (vla-get-Lock layer) :vlax-true)
          (BTD:Check (vl-catch-all-apply 'vla-put-Lock (list layer :vlax-false))
                     "Unable to temporarily unlock a bound layer"))
      )
      (princ "\nCleaning hidden-layer geometry and hatches inside bound blocks...")
      (BTD:PruneHiddenGeometry doc)

      ;; 6. Process all text (including deep inside block definitions!)
      (ProcessTextToStaticHeight)

      ;; 7. DEEP PURGE: Remove unused bloated definitions
      (princ "\nPurging unused data...")
      (vl-cmdf "_.-PURGE" "_All" "*" "_No")
      (vl-cmdf "_.-PURGE" "_All" "*" "_No") ; Run twice to catch nested orphans

      ;; 8. Export the DXF at 6-decimal precision
      (princ "\nWriting DXF File...")
      (setq tempPath (vl-filename-mktemp "BakeToDXF-" (vl-filename-directory dxfPath) ".dxf"))
      (if (findfile tempPath) (vl-file-delete tempPath))
      (vl-cmdf "_.DXFOUT" tempPath "6")
      (if (or (not (findfile tempPath)) (not (> (vl-file-size tempPath) 0)))
        (progn (princ "\nDXFOUT did not produce a nonempty DXF. Destination left unchanged.") (exit))
      )

      ;; 9. Roll the active drawing back!
      (setq rollbackResult (vl-catch-all-apply 'command-s (list "_.UNDO" "_Back"))
            undoMarked nil)
      (if (vl-catch-all-error-p rollbackResult)
        (progn
          (princ "\nWARNING: Rollback failed. Inspect the drawing and use UNDO manually; destination left unchanged.")
          (exit)
        )
      )
      (setvar "FILEDIA" oldFiledia)
      (setvar "CMDDIA" oldCmddia)
      (if (findfile dxfPath)
        (progn
          (setq backupPath (vl-filename-mktemp "BakeToDXF-backup-" (vl-filename-directory dxfPath) ".dxf"))
          (if (findfile backupPath) (vl-file-delete backupPath))
          (if (not (vl-file-rename dxfPath backupPath))
            (progn (princ "\nCannot back up the existing destination; it was not replaced.") (exit)))
        )
      )
      (if (not (vl-file-rename tempPath dxfPath))
        (progn (princ "\nCannot move the exported DXF to its destination.") (exit)))
      (setq tempPath nil)
      (if (and backupPath (findfile backupPath))
        (if (vl-file-delete backupPath)
          (setq backupPath nil)
          (princ (strcat "\nPrevious DXF backup retained at: " backupPath))))

      (princ (strcat "\nSuccess! Lightweight DXF exported safely to: " dxfPath))
      (if (wcmatch (strcase (getvar "PLATFORM")) "*WINDOWS*")
        (vl-catch-all-apply 'startapp (list "explorer.exe" (strcat "/select,\"" dxfPath "\""))))
    )
    (princ "\nExport cancelled by user.")
  )
  (princ)
)

;; ==============================================================================
;; SEPARATED FEATURE: Deep Text Processing
;; Resizes all text (including nested in blocks and attributes) to 0.15m
;; and strips annotative properties.
;; ==============================================================================
(defun ProcessTextToStaticHeight ( / acadObj doc blocks blk obj objName ent entData extDict i ss insertObj atts attResult j )
  (princ "\nProcessing all Text, including inside Blocks...")

  (setq acadObj (vlax-get-acad-object)
        doc (vla-get-ActiveDocument acadObj)
        blocks (vla-get-Blocks doc)
        i 0)

  ;; A. PROCESS TEXT INSIDE ALL BLOCK DEFINITIONS
  (vlax-for blk blocks
    (if (= (vla-get-IsXRef blk) :vlax-false)
      (vlax-for obj blk
        (setq objName (vla-get-ObjectName obj))
        (if (and (BTD:LayerVisibleP (vla-get-Layer obj))
           (or (= objName "AcDbText")
                (= objName "AcDbMText")
          (= objName "AcDbAttributeDefinition")))
          (progn
            (setq ent (vlax-vla-object->ename obj))
            (setq entData (entget ent))

            ;; Strip Annotative Property
            (if (setq extDict (cdr (assoc 360 entData)))
              (if (dictsearch extDict "AcDbContextDataManager")
                (dictremove extDict "AcDbContextDataManager")
              )
            )

            ;; Force target height
            (vl-catch-all-apply 'vla-put-Height (list obj 0.15))
            (setq i (1+ i))
          )
        )
      )
    )
  )

  ;; B. PROCESS LIVE BLOCK ATTRIBUTES IN MODEL/PAPER SPACE
  (if (setq ss (ssget "_X" '((0 . "INSERT") (66 . 1))))
    (progn
      (setq j 0)
      (while (< j (sslength ss))
        (setq insertObj (vlax-ename->vla-object (ssname ss j)))
        (setq atts (vlax-variant-value (vla-GetAttributes insertObj))
              attResult (vl-catch-all-apply 'vlax-safearray->list (list atts)))
        (if (and (BTD:LayerVisibleP (vla-get-Layer insertObj))
                 (not (vl-catch-all-error-p attResult)))
          (mapcar
            '(lambda (att)
               (if (BTD:LayerVisibleP (vla-get-Layer att))
                 (progn
               (setq ent (vlax-vla-object->ename att))
               (if (setq extDict (cdr (assoc 360 (entget ent))))
                 (if (dictsearch extDict "AcDbContextDataManager")
                   (dictremove extDict "AcDbContextDataManager")
                 )
               )
               (vl-catch-all-apply 'vla-put-Height (list att 0.15))
               (setq i (1+ i))
                 )
               )
             )
            attResult
          )
        )
        (setq j (1+ j))
      )
    )
  )

  (princ (strcat "\nRe-sized and stripped annotative data from " (itoa i) " text features."))
  (princ)
)

(princ "\nLoaded successfully. Type BAKETODXF to execute.")
(princ)
